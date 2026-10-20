"""Write scraper results into data/ as CSV and JSON.

Every file is written to a temp file in the same folder and renamed into place,
so a crash never leaves half a CSV behind. Cell conventions:
- lists of plain codes use "|"   (gen_ed: "humanities|international")
- trees and id lists use JSON    (tree: {"type":"or","items":[...]})
- missing values are empty cells, never a made-up default
- every row carries catalog_year, source_url and fetched_at
"""

from __future__ import annotations

import csv
import io
import json
import os
import tempfile
from pathlib import Path
from typing import Iterable

from . import catalog, examcredit, ids, soc
from .fetch import Page

COURSE_HEADER = [
    "id", "code", "name", "credits_min", "credits_max", "description", "grading",
    "gen_ed", "quest", "writing_words", "other_attributes", "dept_slug",
    "override_reason", "catalog_year", "source_url", "fetched_at",
]
REQUISITE_HEADER = [
    "course_id", "kind", "status", "tree", "mentions", "raw_text",
    "override_reason", "catalog_year", "source_url", "fetched_at",
]


# ============================================================================
# Atomic writes
# ============================================================================

def atomic_write_text(path: Path, text: str) -> None:
    """Write to a temp file beside `path`, then rename it over `path`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def write_csv(path: Path, header: list[str], rows: Iterable[list]) -> int:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    count = 0
    for row in rows:
        writer.writerow(row)
        count += 1
    atomic_write_text(path, buffer.getvalue())
    return count


def write_json(path: Path, data: object) -> None:
    atomic_write_text(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")


# ============================================================================
# Cell formatting
# ============================================================================

def _num(value: float | None) -> str:
    """3.0 -> "3", 1.5 -> "1.5", None -> ""."""
    if value is None:
        return ""
    return str(int(value)) if value == int(value) else str(value)


def _json(value: object) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


# ============================================================================
# Catalog
# ============================================================================

def write_catalog(out_dir: Path, courses: Iterable[catalog.Course], pages: dict[str, Page],
                  reasons: dict[str, str], catalog_year: str, manifest: dict) -> None:
    """data/catalog/courses.csv, requisites.csv and manifest.json.
    `pages` maps dept_slug -> the Page each course was parsed from."""
    courses = sorted(courses, key=lambda c: c.id)

    def provenance(course: catalog.Course) -> list[str]:
        page = pages[course.dept_slug]
        return [reasons.get(course.id, ""), catalog_year, page.url, page.fetched_at.isoformat()]

    course_count = write_csv(out_dir / "courses.csv", COURSE_HEADER, (
        [c.id, c.code, c.name, _num(c.credits_min), _num(c.credits_max), c.description,
         c.grading or "", "|".join(c.gen_ed), "|".join(c.quest), c.writing_words or "",
         "|".join(c.other_attributes), c.dept_slug, *provenance(c)]
        for c in courses
    ))

    requisite_count = write_csv(out_dir / "requisites.csv", REQUISITE_HEADER, (
        [c.id, kind, req.status, _json(req.tree), _json(req.mentions), req.raw_text, *provenance(c)]
        for c in courses
        for kind, req in (("prereq", c.prereq), ("coreq", c.coreq))
        if req is not None
    ))

    fetched = sorted(page.fetched_at for page in pages.values())
    write_json(out_dir / "manifest.json", {
        "source": "catalog.ufl.edu",
        "catalog_year": catalog_year,
        "department_pages": len(pages),
        "fetched_from": fetched[0].isoformat() if fetched else None,
        "fetched_to": fetched[-1].isoformat() if fetched else None,
        "files": {"courses.csv": course_count, "requisites.csv": requisite_count},
        **manifest,
    })


# ============================================================================
# Schedule of Courses
# ============================================================================

SECTION_HEADER = [
    "term", "class_number", "course_id", "uf_course_id", "section", "credits_min", "credits_max",
    "career", "delivery", "categories", "instructors", "gen_ed", "quest", "elal", "ai", "topic",
    "dept_name", "source_url", "fetched_at",
]
SOC_COURSE_HEADER = [
    "course_id", "code", "uf_course_ids", "name", "description", "first_seen_term", "last_seen_term",
    "terms", "seasons", "careers", "source_url", "fetched_at",
]
SOC_REQUISITE_HEADER = [
    "course_id", "kind", "status", "tree", "mentions", "raw_text", "term", "source_url", "fetched_at",
]
TERM_HEADER = ["term", "name", "closed", "complete", "problems", "sections", "courses", "pages", "fetched_from", "fetched_to"]


def write_soc(out_dir: Path, results: list[soc.TermResult], closed: dict[str, bool], manifest: dict) -> None:
    """data/soc/: sections/<term>.csv per term, plus courses.csv (one row per
    course across every term), requisites.csv (SOC prerequisite text, parsed),
    terms.csv and manifest.json.

    Per-term section files keep git diffs small: a closed term's file is
    rewritten byte-for-byte identical, so only live terms ever show changes."""
    for result in results:
        write_csv(out_dir / "sections" / f"{result.term}.csv", SECTION_HEADER, (
            [s.term, s.class_number, s.course_id, s.uf_course_id, s.section, _num(s.credits_min),
             _num(s.credits_max), s.career, s.delivery, "|".join(s.categories), "|".join(s.instructors),
             "|".join(s.gen_ed), "|".join(s.quest), s.elal, s.ai, s.topic, s.dept_name,
             s.page.url, s.page.fetched_at.isoformat()]
            for s in result.sections
        ))

    # Roll every term up into one row per course. Results are oldest first, so
    # the LAST listing seen is the newest description of the course.
    terms_of: dict[str, list[str]] = {}
    careers_of: dict[str, list[str]] = {}
    uf_ids_of: dict[str, list[str]] = {}
    latest: dict[str, soc.Listing] = {}
    latest_prereq: dict[str, soc.Listing] = {}
    for result in results:
        for listing in result.listings:
            terms_of.setdefault(listing.course_id, []).append(result.term)
            if listing.uf_course_id and listing.uf_course_id not in uf_ids_of.setdefault(listing.course_id, []):
                uf_ids_of[listing.course_id].append(listing.uf_course_id)
            latest[listing.course_id] = listing
            if listing.prereq_text or listing.coreq_text:
                latest_prereq[listing.course_id] = listing
        for s in result.sections:
            if s.career and s.career not in careers_of.setdefault(s.course_id, []):
                careers_of[s.course_id].append(s.career)

    course_count = write_csv(out_dir / "courses.csv", SOC_COURSE_HEADER, (
        [cid, latest[cid].code, "|".join(uf_ids_of.get(cid, [])), latest[cid].name, latest[cid].description,
         terms[0], terms[-1], "|".join(terms),
         "|".join(s for s in ("spring", "summer", "fall") if any(ids.term_season(t) == s for t in terms)),
         "|".join(careers_of.get(cid, [])), latest[cid].page.url, latest[cid].page.fetched_at.isoformat()]
        for cid, terms in sorted(terms_of.items())
    ))

    def requisite_rows(listing: soc.Listing):
        for kind, text in (("prereq", listing.prereq_text), ("coreq", listing.coreq_text)):
            if text:
                req = catalog.parse_requisite(text)
                yield [listing.course_id, kind, req.status, _json(req.tree), _json(req.mentions), req.raw_text,
                       listing.term, listing.page.url, listing.page.fetched_at.isoformat()]

    requisite_count = write_csv(out_dir / "requisites.csv", SOC_REQUISITE_HEADER,
                                (row for cid in sorted(latest_prereq) for row in requisite_rows(latest_prereq[cid])))

    def fetched(result: soc.TermResult, pick) -> str:
        return pick(p.fetched_at for p in result.pages).isoformat() if result.pages else ""

    write_csv(out_dir / "terms.csv", TERM_HEADER, (
        [r.term, ids.term_name(r.term), closed[r.term], r.complete, " | ".join(r.problems), len(r.sections), len(r.listings), len(r.pages),
         fetched(r, min), fetched(r, max)]
        for r in results
    ))

    renumbered: dict[str, set[str]] = {}
    for cid, uf_ids in uf_ids_of.items():
        for uf_id in uf_ids:
            renumbered.setdefault(uf_id, set()).add(cid)
    renumbered = {k: v for k, v in renumbered.items() if len(v) > 1}
    write_json(out_dir / "manifest.json", {
        "source": "one.uf.edu/apix/soc",
        "terms": [r.term for r in results],
        "incomplete_terms": {r.term: r.problems for r in results if not r.complete},
        "files": {"courses.csv": course_count, "requisites.csv": requisite_count,
                  "sections": {r.term: len(r.sections) for r in results}},
        "renumbered_courses": {"count": len(renumbered),
                               "samples": {k: sorted(v) for k, v in sorted(renumbered.items())[:20]}},
        **manifest,
    })


# ============================================================================
# Exam credit
# ============================================================================

EXAM_CREDIT_HEADER = [
    "id", "family", "exam", "min_score", "max_score", "score_label", "course_ids", "credits",
    "credits_source", "gen_ed", "writing_words", "award_text", "catalog_year", "source_url", "fetched_at",
]


def write_exam_credit(out_dir: Path, awards: list[examcredit.ExamAward], page: Page, catalog_year: str,
                      manifest: dict) -> None:
    """data/exam_credit/awards.csv and manifest.json."""
    count = write_csv(out_dir / "awards.csv", EXAM_CREDIT_HEADER, (
        [a.id, a.family, a.exam, a.min_score, a.max_score, a.score_label, "|".join(a.course_ids), a.credits,
         a.credits_source, "|".join(a.gen_ed), a.writing_words or "", a.award_text,
         catalog_year, page.url, page.fetched_at.isoformat()]
        for a in awards
    ))
    families: dict[str, int] = {}
    sources: dict[str, int] = {}
    for a in awards:
        families[a.family] = families.get(a.family, 0) + 1
        sources[a.credits_source] = sources.get(a.credits_source, 0) + 1
    write_json(out_dir / "manifest.json", {
        "source": page.url,
        "catalog_year": catalog_year,
        "fetched_at": page.fetched_at.isoformat(),
        "files": {"awards.csv": count},
        "awards_by_family": families,
        "credits_source": sources,
        **manifest,
    })


# ============================================================================
# Programs
# ============================================================================

PROGRAM_HEADER = ["id", "name", "kind", "degree", "college_slug", "status", "confidence",
                  "catalog_year", "source_url", "fetched_at", "fingerprint", "override_reason"]
REQUIREMENT_HEADER = ["program_id", "group_key", "name", "rtype", "logic", "eligible_course_ids",
                      "required_credits", "required_course_count", "sort_order", "section"]
PLAN_HEADER = ["program_id", "semester_index", "position", "course_id", "placeholder", "credits",
               "is_critical_tracking", "is_summer", "alt_group", "alt_option"]
MILESTONE_HEADER = ["program_id", "semester", "kind", "slots", "count", "pool", "raw_text"]
QA_HEADER = ["program_id", "severity", "group_key", "message", "advisory"]


def write_programs(out_dir: Path, items: list[tuple], catalog_year: str, manifest: dict) -> None:
    """data/programs/: programs.csv, requirements.csv, plans.csv, milestones.csv,
    qa.csv and manifest.json. items: [(ParsedProgram, QAResult, status, Page)]."""
    items = sorted(items, key=lambda item: item[0].program.id)
    files = {}
    files["programs.csv"] = write_csv(out_dir / "programs.csv", PROGRAM_HEADER, (
        [p.program.id, p.program.name, p.program.kind, p.program.degree or "", p.program.college_slug or "",
         status, qa_result.confidence, catalog_year, page.url, page.fetched_at.isoformat(),
         p.fingerprint, p.override_reason]
        for p, qa_result, status, page in items
    ))
    files["requirements.csv"] = write_csv(out_dir / "requirements.csv", REQUIREMENT_HEADER, (
        [p.program.id, g.group_key, g.name, g.rtype, _json(g.logic), _json(g.eligible_course_ids),
         _num(g.required_credits), "" if g.required_course_count is None else g.required_course_count,
         g.sort_order, g.section]
        for p, _, _, _ in items for g in p.groups
    ))
    files["plans.csv"] = write_csv(out_dir / "plans.csv", PLAN_HEADER, (
        [p.program.id, r.semester_index, r.position, r.course_id or "", r.placeholder or "", _num(r.credits),
         r.is_critical_tracking, r.is_summer, "" if r.alt_group is None else r.alt_group,
         "" if r.alt_option is None else r.alt_option]
        for p, _, _, _ in items for r in p.plan
    ))
    files["milestones.csv"] = write_csv(out_dir / "milestones.csv", MILESTONE_HEADER, (
        [p.program.id, m.semester, m.kind, _json(m.slots), "" if m.count is None else m.count,
         _json(m.pool), m.raw_text]
        for p, _, _, _ in items for m in p.milestones
    ))
    files["qa.csv"] = write_csv(out_dir / "qa.csv", QA_HEADER, (
        [p.program.id, i["severity"], i["group_key"], i["message"], i.get("advisory", False)]
        for p, qa_result, _, _ in items for i in qa_result.issues
    ))

    statuses: dict[str, int] = {}
    kinds: dict[str, dict[str, int]] = {}
    for p, _, status, _ in items:
        statuses[status] = statuses.get(status, 0) + 1
        by_kind = kinds.setdefault(p.program.kind, {})
        by_kind[status] = by_kind.get(status, 0) + 1
    fetched = sorted(page.fetched_at for *_, page in items)
    write_json(out_dir / "manifest.json", {
        "source": "catalog.ufl.edu program pages",
        "catalog_year": catalog_year,
        "fetched_from": fetched[0].isoformat() if fetched else None,
        "fetched_to": fetched[-1].isoformat() if fetched else None,
        "files": files,
        "status": statuses,
        "status_by_kind": kinds,
        **manifest,
    })
