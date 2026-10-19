"""UF's Schedule of Courses (SOC) JSON API: which courses ran in which term.

one.uf.edu/apix/soc is the API UF's own Schedule of Courses page calls. It is
undocumented, so this module is deliberately strict:
- _assert_shape fails the run the moment a response stops looking like what
  we expect, instead of quietly ingesting something else.
- Pages are cursor-chained: each response's LASTCONTROLNUMBER is the cursor for
  the next request. A term is complete only when the rows retrieved add up to
  TOTALROWS; stopping short raises, so a truncated term is never written.
- Only main terms are collected ("2218"); the summer sub-terms SOC also lists
  ("22156W1" = Summer A 2021) are subsets of the main summer term.

Collected per section: class number, course, section number, credits,
instructors, delivery code, academic career, Gen Ed / Quest / experiential
learning (ELAL) / AI attributes, and the topic title of rotating-topic courses.
NOT collected: meeting times, rooms, seats (decided for this project; meeting
times also need a signed-in UF session).

Collected per course per term: UF's internal courseId, which stays the same
when a course is renumbered (FOR 4911 -> FNR 4911 share courseId 026968), plus
name, description and prerequisite text for courses the current catalog no
longer lists.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Iterator

from . import config, ids
from .fetch import Fetcher, FetchError, HTTPStatusError, Page

log = logging.getLogger("scraper.soc")

SCHEDULE_URL = f"{config.SOC_BASE_URL}/schedule"
FILTERS_URL = f"{config.SOC_BASE_URL}/filters"


# ============================================================================
# Records
# ============================================================================

@dataclass
class Section:
    term: str
    class_number: int
    course_id: str
    uf_course_id: str               # SOC "courseId", stable across renumbering
    section: str                    # SOC "number", e.g. "FOS1" or "1146"
    credits_min: float | None
    credits_max: float | None
    career: str                     # UGRD | GRAD | MED | LAW | ...
    delivery: str                   # UF's sectWeb code: PC | HB | PD | AD
    categories: list[str] = field(default_factory=list)   # CWSP / UFOL it was listed under
    instructors: list[str] = field(default_factory=list)
    gen_ed: list[str] = field(default_factory=list)
    quest: list[str] = field(default_factory=list)
    elal: str = ""                  # experiential-learning type, e.g. "Independent Study"
    ai: str = ""                    # AI designation, e.g. "Enable-AI"
    topic: str = ""                 # rotating-topic title for special-topics sections
    dept_name: str = ""
    page: Page | None = None        # where this row came from (source_url, fetched_at)


@dataclass
class Listing:
    """A course as SOC described it in one term (course-level fields)."""

    term: str
    course_id: str
    uf_course_id: str
    code: str
    name: str
    description: str
    prereq_text: str                # label stripped: "MAC 2311", not "Prereq: MAC 2311"
    coreq_text: str
    page: Page


@dataclass
class TermResult:
    term: str
    sections: list[Section]
    listings: list[Listing]
    pages: list[Page]
    problems: list[str] = field(default_factory=list)  # empty = every row retrieved

    @property
    def complete(self) -> bool:
        return not self.problems


# ============================================================================
# Terms
# ============================================================================

def parse_published_terms(filters: object) -> list[str]:
    """Main term codes SOC currently lists, oldest first."""
    terms = filters.get("terms") if isinstance(filters, dict) else None
    if not isinstance(terms, list):
        raise FetchError("SOC /filters has no readable term list; update scraper/scraper/soc.py")
    codes = {str(t.get("CODE")) for t in terms if isinstance(t, dict)}
    return sorted(c for c in codes if ids.is_term_code(c))


def is_closed(term: str, today: date) -> bool:
    """True once a term has ended, so its listing can no longer change and its
    pages can be cached forever. Uses conservative end dates (a few weeks past
    UF's calendar) so a term is never frozen while UF is still editing it."""
    year, season = ids.term_year(term), ids.term_season(term)
    ends = {"spring": date(year, 6, 1), "summer": date(year, 9, 1), "fall": date(year + 1, 1, 15)}
    return today >= ends[season]


# ============================================================================
# Pages
# ============================================================================

def _assert_shape(payload: object, where: str) -> dict:
    ok = (isinstance(payload, list) and payload and isinstance(payload[0], dict)
          and {"COURSES", "TOTALROWS", "LASTCONTROLNUMBER"} <= payload[0].keys())
    if not ok:
        got = sorted(payload[0].keys()) if isinstance(payload, list) and payload and isinstance(payload[0], dict) \
            else type(payload).__name__
        raise FetchError(f"SOC response shape changed ({where}): expected "
                         f"[{{COURSES, TOTALROWS, LASTCONTROLNUMBER}}], got {got}; update scraper/scraper/soc.py")
    return payload[0]


def _int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None  # "VAR" credits


def _first_number(*values) -> float | None:
    """The first value that parses as a number (0 included), else None."""
    for v in values:
        if (f := _float(v)) is not None:
            return f
    return None


_unknown_labels: set[str] = set()  # each unknown label is logged once per run, not per section


def _labels(values, convert, course_id: str) -> list[str]:
    out = []
    for value in values or []:
        code = convert(str(value))
        if code is None:
            if value not in _unknown_labels:
                _unknown_labels.add(value)
                log.warning("unknown SOC label %r (first seen on %s)", value, course_id)
        elif code not in out:
            out.append(code)
    return out


_REQ_LABEL_RE = re.compile(r"\b(Prereq(?:uisite)?s?|Coreq(?:uisite)?s?|Credits)\s*:", re.IGNORECASE)


def split_requisite_text(text: str) -> tuple[str, str]:
    """SOC packs labeled parts into one field:
        'Credits: 2; Prereq: senior standing (4EG). Coreq: ABE 4042C.'
    Returns (prerequisite text, corequisite text) with the labels removed.
    'Credits:' parts are dropped (credits come from the section itself);
    unlabeled text is treated as prerequisite text."""
    text = " ".join(text.split())
    parts = {"prereq": [], "coreq": []}
    matches = list(_REQ_LABEL_RE.finditer(text))
    if not matches or matches[0].start() > 0:  # text before the first label
        parts["prereq"].append(text[:matches[0].start() if matches else len(text)])
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        label = m.group(1).lower()
        if not label.startswith("credit"):
            parts["coreq" if label.startswith("coreq") else "prereq"].append(text[m.end():end])
    return tuple(" ".join(p.strip(" ;") for p in parts[k] if p.strip(" ;")) for k in ("prereq", "coreq"))


def parse_page(payload: object, term: str, category: str, page: Page) -> tuple[list[Listing], list[Section], dict]:
    """One SOC response -> (course listings, sections, paging info)."""
    body = _assert_shape(payload, f"term={term} category={category}")
    listings: list[Listing] = []
    sections: list[Section] = []
    for course in body.get("COURSES") or []:
        code = course.get("code") or ""
        course_id = ids.code_to_id(code)
        if not ids.is_course_id(course_id):
            log.warning("term %s: skipping SOC course with unreadable code %r", term, code)
            continue
        uf_course_id = str(course.get("courseId") or "")
        prereq_text, coreq_text = split_requisite_text(course.get("prerequisites") or "")
        listings.append(Listing(
            term=term, course_id=course_id, uf_course_id=uf_course_id, code=ids.id_to_code(course_id),
            name=(course.get("name") or "").strip(),
            description=" ".join((course.get("description") or "").split()),
            prereq_text=prereq_text,
            coreq_text=coreq_text,
            page=page,
        ))
        for s in course.get("sections") or []:
            class_number = _int(s.get("classNumber"))
            if class_number is None:
                log.warning("term %s: %s has a section with no class number", term, course_id)
                continue
            # "is None", not "or": SOC sends credits_min 0 with credits "VAR" for
            # 0-N credit sections (research, independent study), and 0 is a value.
            credits_min = _first_number(s.get("credits_min"), s.get("credits"))
            credits_max = _first_number(s.get("credits_max"), credits_min)
            sections.append(Section(
                term=term, class_number=class_number, course_id=course_id, uf_course_id=uf_course_id,
                section=str(s.get("number") or ""),
                credits_min=credits_min, credits_max=credits_max,
                career=s.get("acadCareer") or "", delivery=s.get("sectWeb") or "",
                categories=[category],
                instructors=[i["name"].strip() for i in s.get("instructors") or [] if (i.get("name") or "").strip()],
                gen_ed=_labels(s.get("genEd"), ids.gen_ed_from_label, course_id),
                quest=_labels(s.get("quest"), ids.quest_from_label, course_id),
                elal=(s.get("elalAttr") or "").strip(),
                ai=(s.get("aiAttr") or "").strip(),
                topic=(s.get("rotateTitle") or "").strip(),
                dept_name=(s.get("deptName") or "").strip(),
                page=page,
            ))
    paging = {"total": _int(body.get("TOTALROWS")) or 0,
              "retrieved": _int(body.get("RETRIEVEDROWS")) or 0,
              "cursor": _int(body.get("LASTCONTROLNUMBER")) or 0,
              "courses": len(body.get("COURSES") or [])}
    return listings, sections, paging


# ============================================================================
# Collecting a term
# ============================================================================

def collect_term(fetcher: Fetcher, term: str, *, closed: bool) -> TermResult:
    """Every section of a term across config.SOC_CATEGORIES.

    A class number listed under two categories (CWSP and UFOL) becomes one
    section with both categories recorded."""
    ttl = None if closed else fetcher.default_ttl
    by_key: dict[tuple[int, str], Section] = {}
    listings: dict[str, Listing] = {}
    pages: list[Page] = []
    problems: list[str] = []

    for category in config.SOC_CATEGORIES:
        try:
            for page, page_listings, page_sections in _iter_pages(fetcher, term, category, ttl):
                pages.append(page)
                for listing in page_listings:
                    listings.setdefault(listing.course_id, listing)
                for section in page_sections:
                    key = (section.class_number, section.course_id)
                    if key in by_key:
                        if category not in by_key[key].categories:
                            by_key[key].categories.append(category)
                    else:
                        by_key[key] = section
        except HTTPStatusError as exc:
            # A 5xx on one page is UF's server failing on that page (measured:
            # Spring 2022 CWSP fails at the same cursor on every retry). Keep
            # what was retrieved, stop this category, and record the gap so
            # the term is visibly incomplete rather than silently short.
            if exc.status < 500:
                raise
            problems.append(f"{category}: stopped after {len(pages)} pages, {exc}")
            log.warning("%s/%s: %s; term kept but marked incomplete", term, category, exc)

    sections = sorted(by_key.values(), key=lambda s: (s.course_id, s.class_number))
    log.info("%s (%s): %d sections, %d courses, %d pages%s", term, ids.term_name(term),
             len(sections), len(listings), len(pages), " (INCOMPLETE)" if problems else "")
    return TermResult(term, sections, list(listings.values()), pages, problems)


def _iter_pages(fetcher: Fetcher, term: str, category: str, ttl) -> Iterator[tuple[Page, list, list]]:
    """Follow the cursor chain until every row is retrieved.

    Stop rule (measured on real responses; never hard-code a page count):
    an empty page, a cursor that fails to advance, or retrieved >= total.
    The first two before the total is reached mean the chain broke early,
    which raises instead of returning a silently truncated term."""
    cursor, retrieved = 0, 0
    while True:
        page = fetcher.get_json(SCHEDULE_URL, {"category": category, "term": term,
                                               "last-control-number": cursor}, ttl=ttl)
        listings, sections, paging = parse_page(page.json(), term, category, page)
        yield page, listings, sections
        retrieved += paging["retrieved"] or paging["courses"]
        if retrieved >= paging["total"]:
            return
        if not paging["courses"] or paging["cursor"] <= cursor:
            raise FetchError(f"{term}/{category}: pagination stopped at {retrieved} of "
                             f"{paging['total']} rows (cursor {cursor} -> {paging['cursor']})")
        cursor = paging["cursor"]
