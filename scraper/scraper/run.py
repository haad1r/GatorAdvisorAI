"""Command-line entry point:  python -m scraper.run <command> [options]

Commands (one is added as each pipeline lands):
    catalog   course pages from catalog.ufl.edu -> data/catalog/

Every command has the same shape:
    fetch (politely, through the cache) -> parse -> override -> validate -> write
and writes nothing unless the whole run succeeded, so data/ always holds either
the previous complete result or the new complete result, never a mix.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter
from dataclasses import asdict

from . import catalog, config, output
from .fetch import Fetcher, FetchError, NetworkBlockedError, Page
from .overrides import OverrideError, apply_overrides, load_overrides
from .validate import ValidationError, validate_catalog

log = logging.getLogger("scraper")


# ============================================================================
# catalog
# ============================================================================

def cmd_catalog(args: argparse.Namespace) -> int:
    pages: dict[str, Page] = {}
    courses: dict[str, catalog.Course] = {}
    years: dict[str | None, list[str]] = {}
    repeats = 0

    try:
        with Fetcher("catalog", force=args.force) as fetcher:
            index = catalog.parse_course_index(fetcher.get(config.COURSES_INDEX_URL).body)
            slugs = sorted(index)
            log.info("course index lists %d department pages", len(slugs))
            if args.dept:
                slugs = [s for s in slugs if args.dept.lower() in s]
                if not slugs:
                    log.error("no department slug contains %r", args.dept)
                    return 1

            failed: list[str] = []
            for slug in slugs:
                try:
                    page = fetcher.get(f"{config.CATALOG_BASE_URL}/UGRD/courses/{slug}/")
                except NetworkBlockedError:
                    raise
                except FetchError as exc:
                    log.error("%s: %s", slug, exc)
                    failed.append(slug)
                    continue
                parsed = catalog.parse_department_page(page.body, slug)
                pages[slug] = page
                years.setdefault(parsed.catalog_year, []).append(slug)
                for course in parsed.courses:
                    first = courses.get(course.id)
                    if first is None:
                        courses[course.id] = course
                        continue
                    # Umbrella pages ("Foreign Languages and Literatures") repeat
                    # their sub-departments' courses word for word. Only a copy
                    # that DISAGREES with the first one is worth a warning.
                    repeats += 1
                    if _comparable(course) != _comparable(first):
                        log.warning("%s differs between %s and %s; keeping %s",
                                    course.id, first.dept_slug, slug, first.dept_slug)
                log.debug("%s: %d courses", slug, len(parsed.courses))

            if failed:
                # Raised INSIDE the with-block so no cooldown stamp is written:
                # the rerun reuses every cached page and retries only these.
                raise FetchError(f"{len(failed)} department pages failed: {', '.join(failed)}")
            requests_made = fetcher.requests_made
    except FetchError as exc:
        log.error("%s", exc)
        log.error("nothing written; rerun to resume (cached pages are reused)")
        return 1

    if set(years) != {config.CATALOG_YEAR}:
        for year, year_slugs in sorted(years.items(), key=lambda kv: str(kv[0])):
            log.error("catalog year %s on %d pages (e.g. %s)", year, len(year_slugs), year_slugs[0])
        log.error("expected only %s (config.CATALOG_YEAR); nothing written", config.CATALOG_YEAR)
        return 1

    try:
        reasons = apply_overrides(courses, load_overrides(config.OVERRIDES_PATH))
        report = validate_catalog(courses)
    except (OverrideError, ValidationError) as exc:
        log.error("%s", exc)
        return 1

    statuses = Counter(req.status for c in courses.values() for req in (c.prereq, c.coreq) if req)
    log.info("parsed %d courses from %d pages (%d repeat listings on umbrella pages); requisites: %s",
             len(courses), len(pages), repeats, ", ".join(f"{n} {s}" for s, n in statuses.most_common()))

    if args.dept or args.dry_run:
        log.info("%s: nothing written", "--dept runs are previews" if args.dept else "dry run")
        return 0

    out_dir = config.DATA_DIR / "catalog"
    output.write_catalog(out_dir, courses.values(), pages, reasons, config.CATALOG_YEAR,
                         {"network_requests": requests_made, "repeat_listings": repeats,
                          "validation": report})
    log.info("wrote %s", out_dir)
    return 0


def _comparable(course: catalog.Course) -> dict:
    """A course's parsed content, minus the page it happened to be read from."""
    data = asdict(course)
    data.pop("dept_slug")
    return data


# ============================================================================
# CLI
# ============================================================================

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m scraper.run",
                                     description="Offline, polite UF data scraper")
    sub = parser.add_subparsers(dest="command", required=True)

    cat = sub.add_parser("catalog", help="course pages from catalog.ufl.edu -> data/catalog/")
    cat.add_argument("--dept", help="only department slugs containing this text (preview; writes nothing)")
    cat.add_argument("--dry-run", action="store_true", help="fetch, parse and validate, but write nothing")
    cat.add_argument("--force", action="store_true", help="allow network requests during the cooldown")
    cat.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    cat.set_defaults(func=cmd_catalog)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)-7s %(name)s: %(message)s",
    )
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
