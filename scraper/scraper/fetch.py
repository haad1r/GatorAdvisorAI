"""Polite, cached HTTP fetching. Every request to a UF server goes through here.

Guarantees:
- One request at a time, with a random 2-5 s gap between real network calls.
  Cache hits are free and never wait.
- 429/503 responses and dropped connections are retried with exponential
  backoff, honoring Retry-After when the server sends it.
- robots.txt is fetched once per host and honored for HTML pages.
- Every response is cached under cache/<source>/. An entry is served until its
  TTL expires; after that it is revalidated with ETag / Last-Modified, and a
  304 refreshes it without re-downloading. ttl=None means "never expires"
  (used for SOC terms that have ended).
- Per-source cooldown: a run that FINISHES after touching the network writes a
  stamp, and until the source's cooldown passes, uncached fetches are refused
  (cache hits still work). An interrupted run writes no stamp, so rerunning it
  replays the cache and resumes where it stopped. force=True overrides.

Usage:
    with Fetcher("catalog") as fetcher:
        page = fetcher.get(url)
        page.body, page.fetched_at
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import tempfile
import time
import urllib.robotparser
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit

import requests

from . import config

log = logging.getLogger("scraper.fetch")

# Passed as a ttl to mean "use this source's configured TTL". A separate
# sentinel is needed because None already means "never expires".
SOURCE_TTL = object()


class FetchError(RuntimeError):
    """A URL could not be fetched: bad status, robots.txt, or retries exhausted."""


class NetworkBlockedError(FetchError):
    """A URL is not cached and the source's network cooldown is active."""


@dataclass(frozen=True)
class Page:
    """A response body plus where it came from and when UF last served it."""

    url: str
    body: str
    fetched_at: datetime
    from_cache: bool

    def json(self) -> object:
        return json.loads(self.body)


# ============================================================================
# Cooldown stamps and atomic writes
# ============================================================================

def _stamp_path(source: str) -> Path:
    return config.CACHE_DIR / source / "last_network_run.json"


def cooldown_remaining(source: str) -> timedelta | None:
    """Time left on a source's network cooldown, or None if none is active."""
    try:
        data = json.loads(_stamp_path(source).read_text(encoding="utf-8"))
        stamp = datetime.fromisoformat(data["last_network_run"])
    except (OSError, ValueError, KeyError):
        return None  # no stamp, or an unreadable one: no cooldown
    remaining = stamp + config.SOURCE_COOLDOWNS[source] - datetime.now(timezone.utc)
    return remaining if remaining > timedelta(0) else None


def _write_stamp(source: str) -> None:
    _atomic_write_text(
        _stamp_path(source),
        json.dumps({"last_network_run": datetime.now(timezone.utc).isoformat()}),
    )


def _atomic_write_text(path: Path, text: str) -> None:
    """Write to a temp file in the same folder, then rename it over the target.
    A crash mid-write leaves the old file (or nothing), never half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


# ============================================================================
# Fetcher
# ============================================================================

class Fetcher:
    def __init__(self, source: str, *, force: bool = False) -> None:
        if source not in config.SOURCE_COOLDOWNS:
            raise ValueError(
                f"unknown source {source!r}: add it to config.SOURCE_COOLDOWNS and config.CACHE_TTLS"
            )
        self.source = source
        self.cache_dir = config.CACHE_DIR / source
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.default_ttl: timedelta | None = config.CACHE_TTLS[source]
        self.requests_made = 0
        self._last_request_at = 0.0
        self._robots: dict[str, urllib.robotparser.RobotFileParser] = {}  # one parser per host
        self.session = requests.Session()
        self.session.headers["User-Agent"] = config.USER_AGENT

        self._cooldown_left = cooldown_remaining(source)
        self.allow_network = force or self._cooldown_left is None
        if self._cooldown_left is not None:
            hours = self._cooldown_left.total_seconds() / 3600
            if force:
                log.warning("%s cooldown active (~%.1fh left), but force=True: network allowed", source, hours)
            else:
                log.info("%s cooldown active (~%.1fh left): serving from cache only", source, hours)

    # --- with-block: the stamp is written only when the run finishes cleanly --

    def __enter__(self) -> Fetcher:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        self.session.close()
        if self.requests_made:
            if exc_type is None:
                _write_stamp(self.source)
                log.info("%s: %d network requests; cooldown stamp written (%s)",
                         self.source, self.requests_made, config.SOURCE_COOLDOWNS[self.source])
            else:
                log.warning("%s: run interrupted after %d network requests; no stamp written, "
                            "so rerunning resumes from the cache", self.source, self.requests_made)
        return False  # never swallow the exception

    # --- public API -----------------------------------------------------------

    def get(self, url: str, *, ttl: timedelta | None | object = SOURCE_TTL) -> Page:
        """Fetch an HTML page. robots.txt is checked."""
        page = self._fetch(url, ttl=ttl, check_robots=True)
        assert page is not None
        return page

    def get_json(self, url: str, params: dict | None = None, *,
                 ttl: timedelta | None | object = SOURCE_TTL) -> Page:
        """Fetch a JSON API response; call .json() on the result.

        Params are sorted into the URL so the same request always produces the
        same cache key. robots.txt is not checked: it governs crawlers walking
        HTML pages, and this is the API UF's own Schedule of Courses page calls.
        """
        if params:
            url = f"{url}?{urlencode(sorted(params.items()))}"
        page = self._fetch(url, ttl=ttl, check_robots=False)
        assert page is not None
        return page

    # --- the cache-then-network core -------------------------------------------

    def _fetch(self, url: str, *, ttl: timedelta | None | object, check_robots: bool,
               tolerate_404: bool = False) -> Page | None:
        """Serve from the cache when fresh, otherwise fetch politely.
        Returns None only for a tolerated 404 (a missing robots.txt)."""
        if ttl is SOURCE_TTL:
            ttl = self.default_ttl

        entry = self._load_entry(url)
        if entry is not None and self._is_fresh(entry, ttl):
            log.debug("cache hit: %s", url)
            return Page(url, entry["body"], datetime.fromisoformat(entry["fetched_at"]), from_cache=True)

        if not self.allow_network:
            hours = self._cooldown_left.total_seconds() / 3600 if self._cooldown_left else 0
            raise NetworkBlockedError(
                f"{url} is not cached and the {self.source} cooldown is active "
                f"(~{hours:.1f}h left); rerun with --force to override"
            )

        if check_robots:
            self._check_robots(url)

        # An expired entry can still be revalidated: "send it only if it changed".
        headers: dict[str, str] = {}
        if entry is not None:
            if entry.get("etag"):
                headers["If-None-Match"] = entry["etag"]
            if entry.get("last_modified"):
                headers["If-Modified-Since"] = entry["last_modified"]

        for attempt in range(config.MAX_RETRIES + 1):
            self._polite_sleep()
            log.info("GET %s%s", url, f" (retry {attempt})" if attempt else "")
            try:
                response = self.session.get(url, timeout=config.REQUEST_TIMEOUT_SECONDS, headers=headers)
            except requests.RequestException as exc:
                self._mark_request()
                self._backoff(attempt, f"connection error ({exc})", url)
                continue
            self._mark_request()

            if response.status_code in (429, 503):
                self._backoff(attempt, f"HTTP {response.status_code}", url,
                              response.headers.get("Retry-After"))
                continue

            if response.status_code == 304 and entry is not None:
                log.info("304 not modified: %s", url)
                entry = self._write_entry(url, entry["body"], entry.get("etag"), entry.get("last_modified"))
                return Page(url, entry["body"], datetime.fromisoformat(entry["fetched_at"]), from_cache=True)

            if response.status_code == 404 and tolerate_404:
                return None

            if not response.ok:
                raise FetchError(f"HTTP {response.status_code} for {url}")

            entry = self._write_entry(url, response.text, response.headers.get("ETag"),
                                      response.headers.get("Last-Modified"))
            return Page(url, response.text, datetime.fromisoformat(entry["fetched_at"]), from_cache=False)

        raise FetchError(f"gave up on {url} after {config.MAX_RETRIES + 1} attempts")

    # --- cache entries ----------------------------------------------------------

    def _cache_path(self, url: str) -> Path:
        digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
        return self.cache_dir / f"{digest}.json"

    def _load_entry(self, url: str) -> dict | None:
        try:
            entry = json.loads(self._cache_path(url).read_text(encoding="utf-8"))
            datetime.fromisoformat(entry["fetched_at"])
            entry["body"]
        except (OSError, ValueError, KeyError):
            return None  # missing or unreadable: treat as not cached
        return entry

    def _is_fresh(self, entry: dict, ttl: timedelta | None) -> bool:
        if ttl is None:
            return True
        return datetime.now(timezone.utc) - datetime.fromisoformat(entry["fetched_at"]) <= ttl

    def _write_entry(self, url: str, body: str, etag: str | None, last_modified: str | None) -> dict:
        entry = {
            "url": url,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "body": body,
            "etag": etag,
            "last_modified": last_modified,
        }
        _atomic_write_text(self._cache_path(url), json.dumps(entry))
        return entry

    # --- politeness -------------------------------------------------------------

    def _polite_sleep(self) -> None:
        """Wait until a random 2-5 s have passed since the previous request."""
        elapsed = time.monotonic() - self._last_request_at
        delay = random.uniform(config.MIN_DELAY_SECONDS, config.MAX_DELAY_SECONDS)
        if elapsed < delay:
            time.sleep(delay - elapsed)

    def _mark_request(self) -> None:
        self._last_request_at = time.monotonic()
        self.requests_made += 1

    def _backoff(self, attempt: int, reason: str, url: str, retry_after: str | None = None) -> None:
        if attempt >= config.MAX_RETRIES:
            log.warning("%s for %s; out of retries", reason, url)
            return  # no point sleeping before giving up
        if retry_after and retry_after.isdigit():
            wait = float(retry_after)
        else:
            wait = config.BACKOFF_BASE_SECONDS * (2 ** attempt)
        log.warning("%s for %s; backing off %.0fs", reason, url, wait)
        time.sleep(wait)

    def _check_robots(self, url: str) -> None:
        """Honor the robots.txt of the host being fetched, read once per host."""
        parts = urlsplit(url)
        host = f"{parts.scheme}://{parts.netloc}"
        robots = self._robots.get(host)
        if robots is None:
            robots = urllib.robotparser.RobotFileParser()
            page = self._fetch(f"{host}/robots.txt", ttl=SOURCE_TTL, check_robots=False, tolerate_404=True)
            robots.parse(page.body.splitlines() if page else [])  # no robots.txt: everything allowed
            self._robots[host] = robots
        if not robots.can_fetch(config.USER_AGENT, url):
            raise FetchError(f"robots.txt disallows {url}; not fetching")