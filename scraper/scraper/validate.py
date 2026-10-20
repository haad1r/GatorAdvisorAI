"""Checks run on parsed data before anything is written.

Two kinds of finding:
- ERRORS mean the data is wrong in a way no consumer could work around (a
  value outside our vocabulary, a malformed id). They raise ValidationError
  and nothing is written.
- Everything else is COUNTED into a report that lands in the manifest:
  requisites that name courses we don't have, courses with no credits, and so
  on. These are facts about UF's data, not bugs, and the audit engine must be
  able to see them rather than have them silently "fixed".

Repairs made here, each counted in the report:
- UF often cites "COP 3503" when the catalog course is "COP 3503C" (lecture+lab
  combined), or the reverse. When exactly one of the two spellings exists, the
  reference is rewritten to it.
- Changed from UF Planner (2026-10-18): a reference to a code the catalog no
  longer has, which the Schedule of Courses shows under the same UF course id as
  exactly one current catalog course ("LIN 3010" -> LIN 2011, "FOS 3042" -> FOS
  2040), is rewritten to that course: UF renumbered it. A reference to a course
  the Schedule offers but the catalog has no page for is counted as
  schedule-only rather than unknown. Both need data/soc/courses.csv; without it
  they are skipped.
"""

from __future__ import annotations

import logging
from collections import Counter

from . import catalog, ids

log = logging.getLogger("scraper.validate")

SAMPLE_SIZE = 20  # how many examples of each finding the report keeps


class ValidationError(RuntimeError):
    pass


def soc_index(soc_rows: list[dict], catalog_ids: set[str]) -> dict:
    """From data/soc/courses.csv rows: {"renumbered": {old id: catalog id},
    "schedule_only": {ids SOC lists that the catalog lacks}}. A code is mapped
    only when its UF course id leads to exactly one catalog course."""
    by_uf: dict[str, set[str]] = {}
    for r in soc_rows:
        for uf in filter(None, (r.get("uf_course_ids") or "").split("|")):
            by_uf.setdefault(uf, set()).add(r["course_id"])
    renumbered: dict[str, str] = {}
    schedule_only: set[str] = set()
    for r in soc_rows:
        cid = r["course_id"]
        if cid in catalog_ids:
            continue
        twins = {c for uf in filter(None, (r.get("uf_course_ids") or "").split("|"))
                 for c in by_uf.get(uf, ()) if c != cid and c in catalog_ids}
        if len(twins) == 1:
            renumbered[cid] = twins.pop()
        else:
            schedule_only.add(cid)
    return {"renumbered": renumbered, "schedule_only": schedule_only}


def validate_catalog(courses: dict[str, catalog.Course], soc: dict | None = None) -> dict:
    """soc: soc_index(...) of the Schedule of Courses, or None to skip the
    renumbering and schedule-only checks."""
    renumbered = (soc or {}).get("renumbered", {})
    schedule_only = (soc or {}).get("schedule_only", set())
    errors: list[str] = []
    for course in courses.values():
        errors.extend(_vocabulary_errors(course))
    if errors:
        raise ValidationError("catalog failed validation:\n  " + "\n  ".join(errors[:50]))

    statuses: Counter[str] = Counter()
    resolved: list[str] = []
    renamed: list[str] = []
    on_schedule: list[str] = []
    unknown: list[str] = []
    self_refs: list[str] = []
    for course in courses.values():
        for kind, req in (("prereq", course.prereq), ("coreq", course.coreq)):
            if req is None:
                continue
            statuses[f"{kind}:{req.status}"] += 1
            for leaf in catalog.leaves(req.tree):
                if leaf["type"] == "credits" and "from" in leaf:
                    leaf["from"] = [renumbered.get(_resolve(c, courses), _resolve(c, courses)) for c in leaf["from"]]
                if leaf["type"] != "course":
                    continue
                target = _resolve(leaf["course_id"], courses)
                if target != leaf["course_id"]:
                    resolved.append(f"{course.id}: {leaf['course_id']} -> {target}")
                    leaf["course_id"] = target
                if target not in courses and target in renumbered:
                    renamed.append(f"{course.id}: {target} -> {renumbered[target]}")
                    target = leaf["course_id"] = renumbered[target]
                if target == course.id:
                    self_refs.append(course.id)
                elif target in schedule_only:
                    on_schedule.append(f"{course.id} -> {target}")
                elif target not in courses:
                    unknown.append(f"{course.id} -> {target}")
            req.mentions = list(dict.fromkeys(
                renumbered.get(_resolve(cid, courses), _resolve(cid, courses)) for cid in req.mentions))

    no_credits = [c.id for c in courses.values() if c.credits_min is None]
    report = {
        "courses": len(courses),
        "requisites": dict(sorted(statuses.items())),
        "resolved_lab_suffix": {"count": len(resolved), "samples": resolved[:SAMPLE_SIZE]},
        "resolved_renumbered": {"count": len(renamed), "samples": renamed[:SAMPLE_SIZE]},
        "schedule_only_references": {"count": len(on_schedule), "samples": on_schedule[:SAMPLE_SIZE]},
        "unknown_course_references": {"count": len(unknown), "samples": unknown[:SAMPLE_SIZE]},
        "self_references": {"count": len(self_refs), "samples": self_refs[:SAMPLE_SIZE]},
        "missing_credits": {"count": len(no_credits), "samples": no_credits[:SAMPLE_SIZE]},
    }
    log.info("validation: %d courses, %d lab-suffix and %d renumbered references resolved, %d "
             "schedule-only, %d references to courses not in this catalog, %d self-references, "
             "%d courses without credits", len(courses), len(resolved), len(renamed), len(on_schedule),
             len(unknown), len(self_refs), len(no_credits))
    return report


def _vocabulary_errors(course: catalog.Course) -> list[str]:
    errors = []
    if not ids.is_course_id(course.id):
        errors.append(f"{course.id!r}: malformed course id")
    for area in course.gen_ed:
        if area not in ids.GEN_ED_AREAS:
            errors.append(f"{course.id}: unknown Gen Ed area {area!r}")
    for level in course.quest:
        if level not in ids.QUEST_LEVELS:
            errors.append(f"{course.id}: unknown Quest level {level!r}")
    if course.grading not in ("letter", "su", None):
        errors.append(f"{course.id}: unknown grading {course.grading!r}")
    if (course.credits_min is not None and course.credits_max is not None
            and course.credits_min > course.credits_max):
        errors.append(f"{course.id}: credits_min {course.credits_min} > credits_max {course.credits_max}")
    return errors


def _resolve(course_id: str, courses: dict) -> str:
    """Map a reference onto the spelling the catalog actually has:
    'cop3503' -> 'cop3503c' (or the reverse) when only that one exists."""
    if course_id in courses:
        return course_id
    if course_id + "c" in courses:
        return course_id + "c"
    if course_id.endswith("c") and course_id[:-1] in courses:
        return course_id[:-1]
    return course_id
