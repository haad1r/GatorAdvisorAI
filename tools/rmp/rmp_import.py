"""RateMyProfessors ratings for UF instructors.

Kept outside scraper/ on purpose: Shaun's scraper honours robots.txt, and
RMP's robots.txt disallows all crawlers. The team decided (2026-11-18) to
collect summary numbers anyway, the way other UF planners do, under these
limits:

- Numbers only: quality, difficulty, would-take-again %, rating count. No
  review text is ever requested or stored.
- One request every 10 s (RMP's Crawl-delay), at most one run a week
  (--force overrides). Roughly 50-100 requests per run.
- The app credits RMP and links to each professor's page, and
  NEXT_PUBLIC_SHOW_RMP=false hides everything.

RMP has no public API. This calls the private GraphQL endpoint its own site
uses, so it can break or be blocked at any time.

Usage (from the repo root, Python 3.10+, standard library only):

    python tools/rmp/rmp_import.py fetch    # RMP -> data/rmp/professors.csv
    python tools/rmp/rmp_import.py match    # + SOC instructors -> data/rmp/instructor_ratings.csv
    python -m unittest discover tools/rmp   # matching tests, no network
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "rmp"
SOC = ROOT / "data" / "soc"

ENDPOINT = "https://www.ratemyprofessors.com/graphql"
# The credentials RMP's own website sends with every request.
AUTH = "Basic " + base64.b64encode(b"test:test").decode()
UF_LEGACY_ID = 1100
SCHOOL_ID = base64.b64encode(f"School-{UF_LEGACY_ID}".encode()).decode()
PAGE_SIZE = 100
DELAY_SECONDS = 10
MIN_DAYS_BETWEEN_RUNS = 7
USER_AGENT = "GatorAdvisor student project (weekly ratings summary)"

QUERY = """
query UfTeachers($query: TeacherSearchQuery!, $count: Int!, $cursor: String) {
  search: newSearch {
    teachers(query: $query, first: $count, after: $cursor) {
      resultCount
      pageInfo { hasNextPage endCursor }
      edges { node {
        legacyId firstName lastName department
        avgRating avgDifficulty wouldTakeAgainPercent numRatings
        school { legacyId }
      } }
    }
  }
}
"""

PROFESSOR_FIELDS = ["legacy_id", "first_name", "last_name", "department", "quality", "difficulty", "would_take_again", "num_ratings"]
MATCH_FIELDS = ["instructor", "match", "legacy_id", "quality", "difficulty", "would_take_again", "num_ratings", "candidates"]


# ---------------------------------------------------------------- fetch


def _post(variables: dict) -> dict:
    body = json.dumps({"query": QUERY, "variables": variables}).encode()
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={"Authorization": AUTH, "Content-Type": "application/json", "User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        payload = json.load(res)
    if payload.get("errors"):
        raise RuntimeError(f"RMP returned errors: {payload['errors']}")
    try:
        return payload["data"]["search"]["teachers"]
    except (KeyError, TypeError) as e:
        raise RuntimeError(f"Unexpected response shape (RMP may have changed its API): {str(payload)[:300]}") from e


def _number(value) -> str:
    """RMP uses 0 and -1 for 'no data'; store those as blanks."""
    if value is None:
        return ""
    v = float(value)
    return "" if v <= 0 else f"{v:g}"


def fetch(force: bool) -> None:
    manifest_path = OUT / "manifest.json"
    if manifest_path.exists() and not force:
        last = datetime.fromisoformat(json.loads(manifest_path.read_text())["fetched_at"])
        if datetime.now(timezone.utc) - last < timedelta(days=MIN_DAYS_BETWEEN_RUNS):
            sys.exit(f"Last fetch was {last:%Y-%m-%d}. Runs are limited to one a week; pass --force to override.")

    rows, cursor, requests, expected = [], None, 0, None
    while True:
        if requests:
            time.sleep(DELAY_SECONDS)
        for attempt in range(3):
            try:
                page = _post({"query": {"text": "", "schoolID": SCHOOL_ID, "fallback": False}, "count": PAGE_SIZE, "cursor": cursor})
                break
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt == 2:
                    raise
                print(f"  request failed ({e}); retrying in {DELAY_SECONDS * (attempt + 2)} s")
                time.sleep(DELAY_SECONDS * (attempt + 2))
        requests += 1
        expected = expected or page.get("resultCount")
        for edge in page["edges"]:
            n = edge["node"]
            if (n.get("school") or {}).get("legacyId") != UF_LEGACY_ID:
                continue
            rows.append({
                "legacy_id": n["legacyId"],
                "first_name": (n.get("firstName") or "").strip(),
                "last_name": (n.get("lastName") or "").strip(),
                "department": (n.get("department") or "").strip(),
                "quality": _number(n.get("avgRating")),
                "difficulty": _number(n.get("avgDifficulty")),
                "would_take_again": _number(n.get("wouldTakeAgainPercent")),
                "num_ratings": int(n.get("numRatings") or 0),
            })
        print(f"  page {requests}: {len(rows)} professors so far (of ~{expected})")
        if not page["pageInfo"]["hasNextPage"]:
            break
        cursor = page["pageInfo"]["endCursor"]

    if expected and len(rows) < expected * 0.9:
        sys.exit(f"Only got {len(rows)} of ~{expected} professors; not writing a partial file.")

    OUT.mkdir(parents=True, exist_ok=True)
    rows.sort(key=lambda r: (r["last_name"].lower(), r["first_name"].lower(), r["legacy_id"]))
    with open(OUT / "professors.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=PROFESSOR_FIELDS)
        w.writeheader()
        w.writerows(rows)
    manifest_path.write_text(json.dumps({
        "source": "ratemyprofessors.com (private GraphQL API)",
        "school_legacy_id": UF_LEGACY_ID,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "professors": len(rows),
        "network_requests": requests,
        "note": "Summary numbers only. No review text.",
    }, indent=2) + "\n")
    print(f"Wrote {len(rows)} professors in {requests} requests.")


# ---------------------------------------------------------------- match


def normalize(name: str) -> str:
    """'José Martín-Ryals' -> 'jose martin ryals'."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z ]", " ", ascii_name.lower())).strip()


@dataclass(frozen=True)
class Professor:
    legacy_id: int
    first: str
    last: str
    department: str
    num_ratings: int
    row: dict

    @property
    def full(self) -> str:
        return normalize(f"{self.first} {self.last}")


def load_professors(path: Path) -> list[Professor]:
    with open(path, encoding="utf-8") as f:
        return [
            Professor(int(r["legacy_id"]), r["first_name"], r["last_name"], r["department"], int(r["num_ratings"] or 0), r)
            for r in csv.DictReader(f)
        ]


def match_one(instructor: str, depts: set[str], profs: list[Professor]) -> tuple[str, Professor | None, list[Professor]]:
    """Returns (method, professor or None, candidates considered).

    Tries, in order: exact full name; same first name and last name with
    middle names ignored; first initial and last name. Several candidates are
    narrowed by department; if more than one is still left it's "ambiguous"
    and gets no rating rather than a guess.
    """
    name = normalize(instructor)
    tokens = name.split()
    if len(tokens) < 2:
        return "none", None, []

    def last_fits(p: Professor) -> bool:
        last = normalize(p.last)
        return bool(last) and (name.endswith(" " + last) or tokens[-1] == last.split()[-1])

    tiers = [
        ("exact", [p for p in profs if p.full == name]),
        ("first_last", [p for p in profs if normalize(p.first).split()[:1] == tokens[:1] and last_fits(p)]),
        ("initial", [p for p in profs if normalize(p.first)[:1] == tokens[0][:1] and last_fits(p)]),
    ]
    for method, found in tiers:
        if not found:
            continue
        if len(found) == 1:
            return method, found[0], found
        dept_words = {normalize(d) for d in depts}
        in_dept = [p for p in found if normalize(p.department) and any(normalize(p.department) in d or d in normalize(p.department) for d in dept_words)]
        if len(in_dept) == 1:
            return method + "+dept", in_dept[0], found
        return "ambiguous", None, found
    return "none", None, []


def open_terms() -> list[str]:
    with open(SOC / "terms.csv", encoding="utf-8") as f:
        return [r["term"] for r in csv.DictReader(f) if r["closed"] == "False"]


def soc_instructors(terms: list[str]) -> dict[str, set[str]]:
    """Instructor name -> departments they teach in, for the given terms."""
    found: dict[str, set[str]] = {}
    for term in terms:
        with open(SOC / "sections" / f"{term}.csv", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                for name in filter(None, (n.strip() for n in r["instructors"].split("|"))):
                    if name.lower() in ("staff", "tba"):
                        continue
                    found.setdefault(name, set()).add(r["dept_name"])
    return found


def match(terms: list[str] | None) -> None:
    profs = load_professors(OUT / "professors.csv")
    overrides_path = OUT / "overrides.json"
    overrides: dict = json.loads(overrides_path.read_text()) if overrides_path.exists() else {}
    by_id = {p.legacy_id: p for p in profs}
    terms = terms or open_terms()
    instructors = soc_instructors(terms)

    out, counts = [], {}
    for name in sorted(instructors, key=str.lower):
        if name in overrides:
            pid = overrides[name]
            method, prof, cands = ("override", by_id.get(pid), []) if pid else ("override_none", None, [])
        else:
            method, prof, cands = match_one(name, instructors[name], profs)
        counts[method] = counts.get(method, 0) + 1
        row = {"instructor": name, "match": method, "candidates": "|".join(str(c.legacy_id) for c in cands) if not prof else ""}
        if prof:
            row.update({k: prof.row[k] for k in ("legacy_id", "quality", "difficulty", "would_take_again", "num_ratings")})
        out.append(row)

    with open(OUT / "instructor_ratings.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=MATCH_FIELDS)
        w.writeheader()
        w.writerows(out)
    matched = sum(1 for r in out if r.get("legacy_id"))
    print(f"Terms {', '.join(terms)}: {len(out)} instructors, {matched} matched ({100 * matched // max(1, len(out))}%).")
    for method, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {method}: {n}")
    print("Fix 'ambiguous' rows by adding {\"Instructor Name\": legacyId} (or null) to data/rmp/overrides.json.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    f = sub.add_parser("fetch", help="download UF professor ratings from RMP")
    f.add_argument("--force", action="store_true", help="ignore the once-a-week limit")
    m = sub.add_parser("match", help="match SOC instructor names to RMP professors")
    m.add_argument("--term", action="append", help="SOC term code, e.g. 2271 (default: every open term)")
    args = parser.parse_args()
    if args.command == "fetch":
        fetch(args.force)
    else:
        match(args.term)


if __name__ == "__main__":
    main()
