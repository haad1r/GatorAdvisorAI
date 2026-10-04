"""Checks run on parsed data before anything is written.

Two kinds of finding:
- ERRORS mean the data is wrong in a way no consumer could work around (a
  value outside our vocabulary, a malformed id). They raise ValidationError
  and nothing is written.
- Everything else is COUNTED into a report that lands in the manifest:
  requisites that name courses we don't have, courses with no credits, and so
  on. These are facts about UF's data, not bugs, and the audit engine must be
  able to see them rather than have them silently "fixed".

The one repair made here: UF often cites "COP 3503" when the catalog course is
"COP 3503C" (lecture+lab combined), or the reverse. When exactly one of the two
spellings exists, the reference is rewritten to it and counted.
"""

from __future__ import annotations

import logging
from collections import Counter

from . import catalog, ids

log = logging.getLogger("scraper.validate")

SAMPLE_SIZE = 20  # how many examples of each finding the report keeps


class ValidationError(RuntimeError):
    pass


def validate_catalog(courses: dict[str, catalog.Course]) -> dict:
    errors: list[str] = []
    for course in courses.values():
        errors.extend(_vocabulary_errors(course))
    if errors:
        raise ValidationError("catalog failed validation:\n  " + "\n  ".join(errors[:50]))

    statuses: Counter[str] = Counter()
    resolved: list[str] = []
    unknown: list[str] = []
    self_refs: list[str] = []
    for course in courses.values():
        for kind, req in (("prereq", course.prereq), ("coreq", course.coreq)):
            if req is None:
                continue
            statuses[f"{kind}:{req.status}"] += 1
            for leaf in catalog.leaves(req.tree):
                if leaf["type"] != "course":
                    continue
                target = _resolve(leaf["course_id"], courses)
                if target != leaf["course_id"]:
                    resolved.append(f"{course.id}: {leaf['course_id']} -> {target}")
                    leaf["course_id"] = target
                if target == course.id:
                    self_refs.append(course.id)
                elif target not in courses:
                    unknown.append(f"{course.id} -> {target}")
            req.mentions = [_resolve(cid, courses) for cid in req.mentions]

    no_credits = [c.id for c in courses.values() if c.credits_min is None]
    report = {
        "courses": len(courses),
        "requisites": dict(sorted(statuses.items())),
        "resolved_lab_suffix": {"count": len(resolved), "samples": resolved[:SAMPLE_SIZE]},
        "unknown_course_references": {"count": len(unknown), "samples": unknown[:SAMPLE_SIZE]},
        "self_references": {"count": len(self_refs), "samples": self_refs[:SAMPLE_SIZE]},
        "missing_credits": {"count": len(no_credits), "samples": no_credits[:SAMPLE_SIZE]},
    }
    log.info("validation: %d courses, %d lab-suffix references resolved, %d references to courses "
             "not in this catalog, %d self-references, %d courses without credits",
             len(courses), len(resolved), len(unknown), len(self_refs), len(no_credits))
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
