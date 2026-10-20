"""Hand corrections applied on top of parsed catalog data.

overrides.json (next to pyproject.toml):

    {
      "courses": {
        "<course_id>": {"reason": "why", "credits_min": 3, "credits_max": 3}
      },
      "requisites": {
        "<course_id>": {"reason": "why", "prereq": "MAC 2311 with minimum grade of C"}
      },
      "exclude": {
        "<course_id>": "why"
      }
    }

Rules:
- Every override must say why. The reason travels into the CSV
  (override_reason column), so a reviewer can always tell what UF published
  from what we changed by hand.
- A requisite override is replacement TEXT, run through the same parser as
  UF's own text, so a hand-written rule can never have a different shape
  from a scraped one. null removes the requisite.
- An override for a course the scrape no longer contains is logged as stale
  rather than silently doing nothing.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from . import catalog

log = logging.getLogger("scraper.overrides")

COURSE_FIELDS = {"name", "credits_min", "credits_max", "description", "grading",
                 "gen_ed", "quest", "writing_words"}
REQUISITE_FIELDS = {"prereq", "coreq"}


class OverrideError(ValueError):
    """overrides.json is malformed: a missing reason or an unknown field."""


def load_overrides(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def apply_overrides(courses: dict[str, catalog.Course], overrides: dict) -> dict[str, str]:
    """Apply overrides to `courses` in place. Returns course id -> reason for
    every course that was changed."""
    reasons: dict[str, str] = {}

    for course_id, reason in overrides.get("exclude", {}).items():
        _require_reason(course_id, reason)
        if courses.pop(course_id, None) is None:
            log.warning("stale override: exclude %s, which the scrape does not contain", course_id)
        else:
            log.info("excluded %s: %s", course_id, reason)

    for course_id, fix in overrides.get("courses", {}).items():
        course = _target(courses, course_id, fix, COURSE_FIELDS)
        if course is None:
            continue
        for name, value in fix.items():
            if name != "reason":
                setattr(course, name, value)
        reasons[course_id] = fix["reason"]

    for course_id, fix in overrides.get("requisites", {}).items():
        course = _target(courses, course_id, fix, REQUISITE_FIELDS)
        if course is None:
            continue
        for name, text in fix.items():
            if name != "reason":
                setattr(course, name, catalog.parse_requisite(text) if text is not None else None)
        reasons[course_id] = "; ".join(r for r in (reasons.get(course_id), fix["reason"]) if r)

    if reasons:
        log.info("applied overrides to %d courses", len(reasons))
    return reasons


def _target(courses: dict, course_id: str, fix: dict, allowed: set[str]) -> catalog.Course | None:
    _require_reason(course_id, fix.get("reason"))
    unknown = set(fix) - allowed - {"reason"}
    if unknown:
        raise OverrideError(f"{course_id}: unknown override fields {sorted(unknown)}; allowed: {sorted(allowed)}")
    if course_id not in courses:
        log.warning("stale override: %s is not in the scrape", course_id)
        return None
    return courses[course_id]


def _require_reason(course_id: str, reason) -> None:
    if not isinstance(reason, str) or not reason.strip():
        raise OverrideError(f"{course_id}: every override needs a non-empty reason")
