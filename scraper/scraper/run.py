"""Command-line entry point:  python -m scraper.run <command> [options]

Commands (one is added as each pipeline lands):
    catalog   course pages from catalog.ufl.edu -> data/catalog/
    soc       Schedule of Courses, Fall 2021 onward -> data/soc/
    examcredit  AP / IB / AICE / ... exam credit -> data/exam_credit/
    programs  majors, minors, certificates -> data/programs/ (run catalog first)
    review    one program's parse beside its override; --stamp marks it checked
    report    needs_review programs by blocker, plus published programs worth auditing

Every command has the same shape:
    fetch (politely, through the cache) -> parse -> override -> validate -> write
and writes nothing unless the whole run succeeded, so data/ always holds either
the previous complete result or the new complete result, never a mix.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from collections import Counter
from dataclasses import asdict
from datetime import date

from bs4 import BeautifulSoup

from . import catalog, config, examcredit, ids, output, programs, qa, soc
from .fetch import Fetcher, FetchError, NetworkBlockedError, Page
from .overrides import OverrideError, apply_overrides, load_overrides
from .validate import ValidationError, soc_index, validate_catalog

PROGRAM_OVERRIDES_DIR = config.SCRAPER_ROOT / "program_overrides"

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
        report = validate_catalog(courses, _soc_index(set(courses)))
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


# ============================================================================
# soc
# ============================================================================

def cmd_soc(args: argparse.Namespace) -> int:
    today = date.today()
    results: list[soc.TermResult] = []
    closed: dict[str, bool] = {}
    try:
        with Fetcher("soc", force=args.force) as fetcher:
            # The term list is always re-read so a newly published term appears.
            published = soc.parse_published_terms(
                fetcher.get_json(soc.FILTERS_URL, ttl=fetcher.default_ttl).json())
            terms = [t for t in published if t >= config.SOC_FIRST_TERM]
            if args.term:
                if args.term not in published:
                    log.error("%s is not a term SOC publishes (newest: %s)", args.term, published[-1])
                    return 1
                terms = [args.term]
            log.info("collecting %d terms: %s (%s) through %s (%s)", len(terms), terms[0],
                     ids.term_name(terms[0]), terms[-1], ids.term_name(terms[-1]))
            for term in terms:
                closed[term] = soc.is_closed(term, today)
                results.append(soc.collect_term(fetcher, term, closed=closed[term]))
            requests_made = fetcher.requests_made
    except FetchError as exc:
        log.error("%s", exc)
        log.error("nothing written; rerun to resume (cached pages are reused)")
        return 1

    if args.term or args.dry_run:
        log.info("%s: nothing written", "--term runs are previews" if args.term else "dry run")
        return 0

    out_dir = config.DATA_DIR / "soc"
    output.write_soc(out_dir, results, closed, {"network_requests": requests_made})
    log.info("wrote %s", out_dir)
    return 0


# ============================================================================
# examcredit
# ============================================================================

def cmd_examcredit(args: argparse.Namespace) -> int:
    try:
        with Fetcher("examcredit", force=args.force) as fetcher:
            page = fetcher.get(config.EXAM_CREDIT_URL)
            requests_made = fetcher.requests_made
    except FetchError as exc:
        log.error("%s", exc)
        return 1

    parsed = examcredit.parse_exam_credit_page(page.body)
    if parsed.catalog_year != config.CATALOG_YEAR:
        log.error("exam-credit page shows catalog year %s, expected %s (config.CATALOG_YEAR); nothing written",
                  parsed.catalog_year, config.CATALOG_YEAR)
        return 1
    families = Counter(a.family for a in parsed.awards)
    missing = [f for f in examcredit.FAMILIES if f not in families]
    if missing:
        log.error("no awards parsed for %s; the page layout may have changed; nothing written", missing)
        return 1
    log.info("parsed %d awards: %s", len(parsed.awards), ", ".join(f"{f} {n}" for f, n in families.items()))
    catalog_rows = _catalog_rows()
    if catalog_rows is None:
        log.warning("data/catalog/courses.csv is missing; assumed awards keep the family default credits")
    else:
        changed = examcredit.apply_course_credits(parsed.awards, _course_credits(catalog_rows))
        log.info("assumed awards naming catalog courses: %d took a credit value other than the default",
                 changed)

    if args.dry_run:
        log.info("dry run: nothing written")
        return 0
    out_dir = config.DATA_DIR / "exam_credit"
    output.write_exam_credit(out_dir, parsed.awards, page, config.CATALOG_YEAR,
                             {"network_requests": requests_made})
    log.info("wrote %s", out_dir)
    return 0


# ============================================================================
# programs
# ============================================================================

# Language prefixes whose 1000-level beginning sequences satisfy the CLAS
# foreign-language requirement, and the words that mark a beginning course.
LANG_PREFIXES = {
    "ara", "asl", "chi", "cht", "fre", "ger", "gre", "grw", "hbr", "hin", "ita", "jpn", "jpt", "kor",
    "lat", "per", "pol", "por", "rus", "spn", "swa", "tur", "ukr", "vie", "yid", "dut", "hai",
}
LANG_NAME_HINTS = ("beginning", "elementary", "intensive", "accelerated", "discover", "review")


def _course_credits(catalog_rows: list[dict]) -> dict[str, float]:
    """Catalog id -> minimum credit hours, for QA's "required list smaller
    than its courses" check (changed from UF Planner, which guessed)."""
    out: dict[str, float] = {}
    for r in catalog_rows:
        try:
            out[r["id"]] = float(r["credits_min"])
        except (TypeError, ValueError):
            pass
    return out


def _expand_subject_electives(parsed: programs.ParsedProgram, known_ids: set[str]) -> None:
    """Turn rows like "<subject> courses at the N000 level or higher" into real
    course pools before scoring: the row states subject, level and credits.
    Shared by `programs` and `review` so both score the same program."""
    parsed.groups.extend(programs.expand_subject_elective_groups(parsed, known_ids, len(parsed.groups)))
    # Credits an expanded row carried still count toward its table's
    # stated total (changed from UF Planner, which dropped them there).
    parsed.total_credit_keys += [g.group_key for g in parsed.groups
                                 if g.logic.get("host_group") in parsed.total_credit_keys
                                 and g.group_key not in parsed.total_credit_keys]


def cmd_programs(args: argparse.Namespace) -> int:
    catalog_rows = _catalog_rows()
    if catalog_rows is None:
        log.error("data/catalog/courses.csv is missing; run `python -m scraper.run catalog` first")
        return 1
    known_ids = {r["id"] for r in catalog_rows}
    course_credits = _course_credits(catalog_rows)
    area_courses: dict[str, list[str]] = {}  # gen-ed area or quest level -> approved course ids
    for r in catalog_rows:
        for code in filter(None, (r["gen_ed"] + "|" + r["quest"]).split("|")):
            area_courses.setdefault(code, []).append(r["id"])
    language_courses = [r["id"] for r in catalog_rows
                        if r["id"][:3] in LANG_PREFIXES and r["id"][3] == "1"
                        and any(w in r["name"].lower() for w in LANG_NAME_HINTS)]
    schedule_only = _schedule_only_ids(known_ids)
    log.info("%d undergraduate courses known only from the Schedule of Courses", len(schedule_only))

    items: list[tuple] = []  # (ParsedProgram, QAResult, status, Page)
    years: dict[str | None, list[str]] = {}
    try:
        with Fetcher("programs", force=args.force) as fetcher:
            listings = programs.parse_programs_index(fetcher.get(config.PROGRAMS_INDEX_URL).body,
                                                     config.CATALOG_BASE_URL)
            log.info("programs index lists %d programs", len(listings))
            if args.program:
                listings = [p for p in listings if args.program.lower() in p["id"]]
                if not listings:
                    log.error("no program id contains %r", args.program)
                    return 1

            failed: list[str] = []
            queue = [dict(p, depth=0) for p in listings]
            seen_urls = {p["url"].rstrip("/") for p in listings}
            while queue:
                listing = queue.pop(0)
                try:
                    page = fetcher.get(listing["url"])
                except NetworkBlockedError:
                    raise
                except FetchError as exc:
                    log.error("%s: %s", listing["id"], exc)
                    failed.append(listing["id"])
                    continue
                # The index knows minor/certificate best.
                parsed = programs.parse_program_page(page.body, listing["url"], listing["kind"])
                if listing.get("name_override"):
                    parsed.program.name = listing["name_override"]

                # Hub pages (Animal Sciences, Music) and combined BA/BS pages keep
                # the real requirements on track subpages: queue those, drop the hub.
                code_parts = set(parsed.program.id.split("-", 1)[-1].split("_"))
                combined = "ba" in code_parts and "bs" in code_parts
                if (not parsed.groups or combined) and listing["depth"] == 0:
                    tracks = [t for t in programs.parse_track_links(page.body, listing["url"], config.CATALOG_BASE_URL)
                              if t["url"].rstrip("/") not in seen_urls]
                    if tracks:
                        log.info("%s: %s page, queueing %d subpages", parsed.program.id,
                                 "combined-degree" if combined else "hub", len(tracks))
                        for t in tracks:
                            seen_urls.add(t["url"].rstrip("/"))
                            queue.append({"id": f"{parsed.program.id}/{t['name']}", "url": t["url"],
                                          "kind": listing["kind"], "depth": 1,
                                          "name_override": f"{parsed.program.name} — {t['name']}"})
                        continue

                parsed.program.catalog_year = catalog.catalog_year_of(BeautifulSoup(page.body, "html.parser"))
                years.setdefault(parsed.program.catalog_year, []).append(parsed.program.id)
                _expand_subject_electives(parsed, known_ids)
                qa_result = qa.evaluate(parsed, known_ids, schedule_only, course_credits)
                overrides = qa.load_program_overrides(PROGRAM_OVERRIDES_DIR, parsed.program.id)
                parsed, forced, stale = qa.apply_program_overrides(parsed, overrides, known_ids | schedule_only)
                if parsed is None:
                    continue
                if overrides:
                    qa_result = qa.evaluate(parsed, known_ids, schedule_only, course_credits)
                if stale:
                    qa_result.add(qa.ERROR, f"stale override, re-review the page and re-stamp it: {stale}")
                status = qa.final_status(qa_result, forced)

                # Gen ed groups are added AFTER scoring: they come from the plan's
                # placeholders plus the catalog's area lists, a template rather
                # than a parse of the page, so they must not raise confidence.
                if parsed.plan and not any(g.section == "geneed" for g in parsed.groups):
                    parsed.groups.extend(programs.derive_gened_groups(parsed.plan, area_courses, len(parsed.groups)))
                if (parsed.program.college_slug == "UGLAS" and parsed.program.kind == "major"
                        and language_courses and "foreign language" in page.body.lower()
                        and not any(g.group_key == "clas-foreign-language" for g in parsed.groups)):
                    parsed.groups.append(programs.clas_foreign_language_group(language_courses, len(parsed.groups)))
                items.append((parsed, qa_result, status, page))

            if failed:
                raise FetchError(f"{len(failed)} program pages failed: {', '.join(failed)}")
            requests_made = fetcher.requests_made
    except (FetchError, ValueError) as exc:
        log.error("%s", exc)
        log.error("nothing written; rerun to resume (cached pages are reused)")
        return 1

    if set(years) != {config.CATALOG_YEAR}:
        for year, ids_ in sorted(years.items(), key=lambda kv: str(kv[0])):
            log.error("catalog year %s on %d program pages (e.g. %s)", year, len(ids_), ids_[0])
        log.error("expected only %s (config.CATALOG_YEAR); nothing written", config.CATALOG_YEAR)
        return 1

    statuses = Counter(status for _, _, status, _ in items)
    log.info("parsed %d programs: %s", len(items), ", ".join(f"{n} {s}" for s, n in statuses.most_common()))
    if args.program or args.dry_run:
        log.info("%s: nothing written", "--program runs are previews" if args.program else "dry run")
        return 0
    out_dir = config.DATA_DIR / "programs"
    output.write_programs(out_dir, items, config.CATALOG_YEAR,
                          {"network_requests": requests_made, "schedule_only_course_ids": len(schedule_only)})
    log.info("wrote %s", out_dir)
    return 0


def cmd_review(args: argparse.Namespace) -> int:
    """Show one program's parse beside its override, from the cache; --stamp
    records that a human checked the current page (see qa.py `reviewed`)."""
    path = config.DATA_DIR / "programs" / "programs.csv"
    catalog_rows = _catalog_rows()
    if catalog_rows is None or not path.exists():
        log.error("needs data/catalog/ and data/programs/; run the catalog and programs commands first")
        return 1
    with open(path, newline="", encoding="utf-8") as f:
        row = next((r for r in csv.DictReader(f) if r["id"] == args.program_id), None)
    if row is None:
        log.error("%s is not in data/programs/programs.csv", args.program_id)
        return 1
    known_ids = {r["id"] for r in catalog_rows}
    course_credits = _course_credits(catalog_rows)
    schedule_only = _schedule_only_ids(known_ids)
    try:
        with Fetcher("programs") as fetcher:
            page = fetcher.get(row["source_url"])
    except FetchError as exc:
        log.error("%s", exc)
        return 1

    parsed = programs.parse_program_page(page.body, row["source_url"], row["kind"])
    parsed.program.catalog_year = catalog.catalog_year_of(BeautifulSoup(page.body, "html.parser"))
    _expand_subject_electives(parsed, known_ids)
    before = qa.evaluate(parsed, known_ids, schedule_only, course_credits)
    override_path = PROGRAM_OVERRIDES_DIR / f"{args.program_id}.json"
    overrides = qa.load_program_overrides(PROGRAM_OVERRIDES_DIR, args.program_id)

    print(f"{args.program_id}  {row['name']} ({row['kind']})")
    print(f"  {row['source_url']}")
    print(f"  catalog {parsed.program.catalog_year}, fingerprint {parsed.fingerprint}, "
          f"page cached {page.fetched_at:%Y-%m-%d}, stated total {parsed.total_credits}")
    print(f"  parse alone: confidence {before.confidence}, {len(before.errors)} errors -> "
          f"{qa.decide_status(before)}")

    if args.stamp:
        if not overrides:
            log.error("%s has no override file to stamp", override_path)
            return 1
        stamped = {"date": date.today().isoformat(), "catalog_year": parsed.program.catalog_year,
                   "fingerprint": parsed.fingerprint}
        # "reviewed" goes right after "reason", so the file reads why -> when -> what.
        merged = {k: v for k, v in overrides.items() if k in ("reason",)}
        merged["reviewed"] = stamped
        merged.update({k: v for k, v in overrides.items() if k not in ("reason", "reviewed")})
        override_path.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"  stamped {override_path.name}: {stamped}")
        overrides = merged

    shown = parsed
    if overrides:
        try:
            shown, forced, stale = qa.apply_program_overrides(parsed, overrides, known_ids | schedule_only)
        except ValueError as exc:
            log.error("override rejected: %s", exc)
            return 1
        if shown is None:
            print("  override EXCLUDES this program")
            return 0
        after = qa.evaluate(shown, known_ids, schedule_only, course_credits)
        print(f"  with override: confidence {after.confidence}, forced status {forced!r}")
        if stale:
            print(f"  STALE: {stale}")
        print(f"  reason: {overrides.get('reason')}")
    else:
        after = before
    print("  groups:")
    for g in shown.groups:
        print(f"    {g.group_key:<42} {g.rtype:<15} {g.section:<9} "
              f"cr={'' if g.required_credits is None else f'{g.required_credits:g}':<5} "
              f"courses={len(g.eligible_course_ids):<3} placeholders={len(g.logic.get('placeholders', []))}")
    for issue in after.issues:
        print(f"    [{issue['severity']}{', advisory' if issue.get('advisory') else ''}] "
              f"{issue['group_key']} {issue['message'][:160]}")
    return 0


# Each needs_review program is filed under its FIRST matching blocker, most
# urgent first. (category, test on its QA messages, what unblocks it)
REVIEW_CATEGORIES = [
    ("stale override", lambda m: "stale override" in m,
     "UF changed the page since a human reviewed it: re-check, fix the override, `review <id> --stamp`"),
    ("no requirements", lambda m: "no requirement groups parsed" in m,
     "prose-only page: hand-author add_groups from the page, or exclude"),
    ("implausible credits", lambda m: "add up to" in m,
     "option lists parsed as required: exclude_groups / patch_groups, or a parser fix if the shape repeats"),
    ("empty chooser", lambda m: "has no parseable options" in m,
     "a 'select' row whose options are prose: patch_groups with the options or a placeholder"),
    ("malformed ids", lambda m: "malformed course ids" in m, "fix the parse or patch the group"),
    ("plan-derived", lambda m: "derived from the model plan" in m,
     "no requirement table, only the model plan (capped at 0.75): accept by override when the spine is real"),
    ("low confidence", lambda m: True,
     "placeholders / unresolved ids: accept by override (>= 0.75, no errors) or patch the placeholders"),
]


AUDIT_SHAPES = [
    ("required list smaller than its courses",
     "a 'take all' list whose credits cannot cover its courses: usually a chooser (patch rtype/logic)"),
    ("group credits sum to",
     "group credits disagree with the page total: a requirement may be missing or double-counted"),
    ("absent from the catalog",
     "course ids in neither the catalog nor the Schedule of Courses: typo, retired, or cross-listed"),
]


def cmd_report(args: argparse.Namespace) -> int:
    """Group every needs_review program by what blocks it, into
    data/programs/review_queue.md (changed from UF Planner, whose gap list
    was written and updated by hand)."""
    out_dir = config.DATA_DIR / "programs"
    if not (out_dir / "programs.csv").exists():
        log.error("data/programs/ is missing; run the programs command first")
        return 1

    def rows(name: str) -> list[dict]:
        with open(out_dir / name, newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))

    catalog_ids = {r["id"] for r in (_catalog_rows() or [])}
    issues: dict[str, list[dict]] = {}
    for r in rows("qa.csv"):
        issues.setdefault(r["program_id"], []).append(r)
    groups: dict[str, list[dict]] = {}
    for r in rows("requirements.csv"):
        groups.setdefault(r["program_id"], []).append(r)
    progs = rows("programs.csv")
    kind_order = {"major": 0, "minor": 1, "certificate": 2}

    filed: dict[str, list[tuple[dict, dict]]] = {name: [] for name, _, _ in REVIEW_CATEGORIES}
    for p in progs:
        if p["status"] == "published":
            continue
        messages = [i["message"] for i in issues.get(p["id"], [])]
        category = next(name for name, test, _ in REVIEW_CATEGORIES if any(test(m) for m in messages)
                        or name == "low confidence")
        major_groups = [g for g in groups.get(p["id"], []) if g["section"] == "major"]
        spine = {c for g in major_groups for c in json.loads(g["eligible_course_ids"]) if c in catalog_ids}
        facts = {
            "placeholders": sum("kept as placeholder" in m for m in messages),
            "absent": sum("absent from the catalog" in m for m in messages),
            "pools": sum(1 for g in groups.get(p["id"], []) if g["section"] == "options"),
            "spine": len(spine),
            "errors": [i["message"] for i in issues.get(p["id"], []) if i["severity"] == "error"],
        }
        filed[category].append((p, facts))

    published = sum(p["status"] == "published" for p in progs)
    lines = [
        "# Program review queue",
        "",
        f"Generated by `python -m scraper.run report` from data/programs/ on {date.today().isoformat()}. "
        "Do not edit by hand; rerun after every `programs` run.",
        "",
        f"**{len(progs)} programs: {published} published, {len(progs) - published} need review.**",
        "",
        "| blocker | majors | minors | certificates | what unblocks it |",
        "|---|---|---|---|---|",
    ]
    for name, _, fix in REVIEW_CATEGORIES:
        counts = Counter(p["kind"] for p, _ in filed[name])
        lines.append(f"| {name} | {counts['major']} | {counts['minor']} | {counts['certificate']} | {fix} |")
    for name, _, fix in REVIEW_CATEGORIES:
        if not filed[name]:
            continue
        lines += ["", f"## {name} ({len(filed[name])})", "", fix, "",
                  "| program | kind | conf | spine | placeholders | unlinked pools | page |",
                  "|---|---|---|---|---|---|---|"]
        for p, f in sorted(filed[name], key=lambda pf: (kind_order.get(pf[0]["kind"], 3), -float(pf[0]["confidence"]))):
            accept = " (accept candidate)" if name == "plan-derived" and f["spine"] >= 12 else ""
            lines.append(f"| `{p['id']}` {p['name']}{accept} | {p['kind']} | {p['confidence']} | {f['spine']} "
                         f"| {f['placeholders']} | {f['pools']} | [link]({p['source_url']}) |")
            for e in f["errors"]:
                lines.append(f"| ↳ {e} | | | | | | |")

    # Published programs are not proven right, only not proven wrong. These
    # warning shapes are the ones most likely to hide a wrong answer, so list
    # them as an audit queue (open the page, compare, override or fix).
    audit = [(p, i) for p in progs if p["status"] == "published"
             for i in issues.get(p["id"], [])
             if any(t in i["message"] for t, _ in AUDIT_SHAPES)]
    if audit:
        lines += ["", f"# Published programs worth auditing ({len({p['id'] for p, _ in audit})})", "",
                  "Published, but carrying a warning that often means a wrong requirement. "
                  "Check each against its page; fix by parser rule (3+ alike) or override.", ""]
        for shape, why in AUDIT_SHAPES:
            hits = [(p, i) for p, i in audit if shape in i["message"]]
            if not hits:
                continue
            lines += ["", f"## {shape} ({len(hits)})", "", why, "",
                      "| program | group | message | page |", "|---|---|---|---|"]
            for p, i in hits:
                lines.append(f"| `{p['id']}` | {i['group_key']} | {i['message'][:140]} | [link]({p['source_url']}) |")
    output.atomic_write_text(out_dir / "review_queue.md", "\n".join(lines) + "\n")
    for name, _, _ in REVIEW_CATEGORIES:
        log.info("%-20s %d", name, len(filed[name]))
    log.info("wrote %s", out_dir / "review_queue.md")
    return 0


def _catalog_rows() -> list[dict] | None:
    path = config.DATA_DIR / "catalog" / "courses.csv"
    if not path.exists():
        return None
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _soc_index(catalog_ids: set[str]) -> dict | None:
    """validate.soc_index over data/soc/courses.csv (renumbered and schedule-only
    requisite references), or None when the soc pipeline hasn't been run."""
    path = config.DATA_DIR / "soc" / "courses.csv"
    if not path.exists():
        log.warning("data/soc/courses.csv is missing; renumbered requisite references stay unresolved")
        return None
    with open(path, newline="", encoding="utf-8") as f:
        return soc_index(list(csv.DictReader(f)), catalog_ids)


def _schedule_only_ids(catalog_ids: set[str]) -> set[str]:
    """Undergraduate course ids in data/soc/ that have no catalog course page.

    UF's catalog publishes no course pages for some departments (Sport
    Management, Telecommunication) although program pages require their
    courses; the Schedule of Courses has offered them, so they are real.
    Empty when the soc pipeline hasn't been run: programs still parse, they
    just score those ids as absent."""
    path = config.DATA_DIR / "soc" / "courses.csv"
    if not path.exists():
        log.warning("data/soc/courses.csv is missing; course ids without a catalog page stay unresolved")
        return set()
    with open(path, newline="", encoding="utf-8") as f:
        return {r["course_id"] for r in csv.DictReader(f)
                if "UGRD" in r["careers"].split("|") and r["course_id"] not in catalog_ids}


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

    sch = sub.add_parser("soc", help="Schedule of Courses, every term since config.SOC_FIRST_TERM -> data/soc/")
    sch.add_argument("--term", help="only this term code, e.g. 2271 (preview; writes nothing)")
    sch.add_argument("--dry-run", action="store_true", help="fetch and parse, but write nothing")
    sch.add_argument("--force", action="store_true", help="allow network requests during the cooldown")
    sch.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    sch.set_defaults(func=cmd_soc)

    exc = sub.add_parser("examcredit", help="AP/IB/AICE/CLEP/DSST/UEXCEL/CAPE/DLPT credit -> data/exam_credit/")
    exc.add_argument("--dry-run", action="store_true", help="fetch and parse, but write nothing")
    exc.add_argument("--force", action="store_true", help="allow network requests during the cooldown")
    exc.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    exc.set_defaults(func=cmd_examcredit)

    prg = sub.add_parser("programs", help="majors, minors, certificates -> data/programs/ (needs data/catalog/)")
    prg.add_argument("--program", help="only program ids containing this text (preview; writes nothing)")
    prg.add_argument("--dry-run", action="store_true", help="fetch, parse and score, but write nothing")
    prg.add_argument("--force", action="store_true", help="allow network requests during the cooldown")
    prg.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    prg.set_defaults(func=cmd_programs)

    rep = sub.add_parser("report", help="needs_review programs by blocker + published programs worth auditing -> data/programs/review_queue.md")
    rep.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    rep.set_defaults(func=cmd_report)

    rev = sub.add_parser("review", help="one program's parse beside its override, from the cache")
    rev.add_argument("program_id", help="exact program id, e.g. uglas-eco_ba")
    rev.add_argument("--stamp", action="store_true",
                     help="record in its override that the current page was checked by hand")
    rev.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    rev.set_defaults(func=cmd_review)

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
