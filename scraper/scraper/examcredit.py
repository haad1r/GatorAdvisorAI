"""Parse UF's exam-credit page into award rows (AP, IB, AICE, CLEP, DSST,
UEXCEL, CAPE, DLPT).

catalog.ufl.edu/UGRD/academic-advising/exam-credit/ publishes one table per
exam family. Each row is an exam and each award column a grant of UF credit.
We flatten that to one row per award:

    family, exam, score band -> course ids + credits + Gen Ed areas + writing words

The tables do not share a shape, so FAMILIES describes each one:
- AP / IB / AICE / DSST / CAPE: one column per score band (CAPE: per unit).
- CLEP: the score is a CELL in its own column, and one exam can appear on
  several rows at different scores.
- DLPT: one row can list seventeen languages earning the same credit;
  split_titles makes each language its own exam, because "Norwegian" is what
  a student searches for.

Where UF states credits we use them ("(4 credits)", or the table's
"3 Credits/Exam unless otherwise noted" row). UEXCEL, CAPE and DLPT state
neither, so their per-column defaults are written down in FAMILIES and every
row says which case applies in credits_source: "explicit" | "table_note" |
"assumed". The audit engine can treat "assumed" as unverified.

An assumed award that names catalog courses takes those courses' credits
instead (apply_course_credits, run after parsing with the catalog loaded):
credits_source "assumed_course". UEXCEL Calculus grants MAC 2311, a 4-credit
course, so the family default of 3 would understate it. Still unverified:
UF printed neither number.

Generic "XXX L000" elective placeholders carry credits but no course id.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import NamedTuple

from bs4 import BeautifulSoup, Tag

from . import catalog, ids

log = logging.getLogger("scraper.examcredit")

# A credit annotation: "(4 credits)", or both parts of a split award spelled
# out, "SPN 1131 and SPN 2200 (5 and 3 credits)". Every number is summed, or
# the 3 in that example would be silently lost.
_CREDITS_RE = re.compile(r"\(([\d\s,]+(?:and[\d\s,]+)*)credits?\)", re.IGNORECASE)
# The note row, written two ways: "3 Credits/Exam unless otherwise noted"
# (AP/IB/AICE/DSST) and "Credits=3 unless noted" (CLEP).
_DEFAULT_CREDITS_RE = re.compile(r"(\d+)\s*Credits?/Exam|Credits?\s*=\s*(\d+)", re.IGNORECASE)
_SCORE_RE = re.compile(r"\d+")
# Footnote markers are <sup>N</sup>. They are swapped for inline sentinels
# before text extraction so writing-word footnotes survive, then stripped.
_FN_SENTINEL = "‡fn{}‡"
_FN_RE = re.compile(r"‡fn(\d+)‡")
_FN_WORDS_RE = re.compile(r"Writing Requirement\s*\((\d[\d,]*)\s*words?\)", re.IGNORECASE)
# Gen Ed column tokens, in order: a full code, a bare number inheriting the
# previous prefix ("BSC 2005, 2010"), a designation letter, or "=".
_GENED_TOKEN_RE = re.compile(
    r"([A-Z]{3})\s*(\d{4}[A-Z]?)|(?<![A-Z0-9])(\d{4}[A-Z]?)(?![0-9])|\b([BCDHMNPS])\b|(=)")
_PARENS_RE = re.compile(r"\([^)]*\)")
# "NA" award cells (no AS-Level award for Further Math): treated as empty.
_NA_RE = re.compile(r"(?:NA|N/A|None|[-—–])\s*\.?", re.IGNORECASE)
# "XUF L009": UF's placeholder for non-UF work that still fulfils Gen Ed.
# Unlike L000 electives it does carry the row's Gen Ed areas.
_XUF_RE = re.compile(r"\bXUF\b")

# (min_score, max_score, score_label, value column). Columns are 0-based among
# the columns AFTER the exam-name column.
Band = tuple[int, int, "str | None", int]

# Strongest first: a number UF printed beats the table's default beats ours.
_SOURCE_STRENGTH = ["explicit", "table_note", "assumed"]


@dataclass(frozen=True)
class FamilySpec:
    header: str                    # matched against the heading above the table
    bands: tuple[Band, ...]
    assumed: dict[int, int]        # column -> credits, ONLY when UF states none
    score_col: int | None = None   # CLEP: the score is a cell in this column
    split_titles: bool = False     # DLPT: one row lists several exams


FAMILIES: dict[str, FamilySpec] = {
    "AP": FamilySpec("AP Exam", ((3, 3, None, 0), (4, 4, None, 1), (5, 5, None, 2)), {0: 3, 1: 6, 2: 6}),
    "IB": FamilySpec("IB Exam", ((4, 4, None, 0), (5, 7, None, 1)), {0: 3, 1: 6}),
    "AICE": FamilySpec("AICE Exam", ((0, 0, "AS Level", 0), (0, 0, "A Level", 1)), {0: 3, 1: 6}),
    "CLEP": FamilySpec("CLEP Exam", ((0, 0, None, 1),), {1: 3}, score_col=0),
    "DSST": FamilySpec("DSST Exam", ((400, 400, None, 0),), {0: 3}),
    # Excelsior College: one passing grade, no numeric score.
    "UEXCEL": FamilySpec("UEXCEL Exam", ((0, 0, "Passing score C", 0),), {0: 3}),
    # Caribbean Examinations Council: the columns are units, not score bands.
    "CAPE": FamilySpec("CAPE Exam", ((0, 0, "Unit 1", 0), (0, 0, "Unit 2", 1)), {0: 3, 1: 3}),
    # Defense Language Institute, ILR scale ("3", "3+"): the label keeps the "+".
    "DLPT": FamilySpec("DLPT Exam", ((3, 3, "Score 3–3+", 0), (4, 5, "Score 4–5", 1)), {0: 6, 1: 9},
                       split_titles=True),
}


@dataclass
class ExamAward:
    id: str                 # stable slug: "ap-calculus-ab-3-5"
    family: str
    exam: str
    min_score: int
    max_score: int
    score_label: str
    course_ids: list[str]
    credits: int
    credits_source: str     # "explicit" | "table_note" | "assumed_course" | "assumed"
    gen_ed: list[str]
    writing_words: int
    award_text: str         # UF's cell text, footnote markers removed


@dataclass
class ExamCreditPage:
    catalog_year: str | None
    awards: list[ExamAward]


class _Grant(NamedTuple):
    lo: int
    hi: int
    label: str | None
    ids: tuple[str, ...]
    credits: int
    source: str
    words: int
    xuf: bool
    text: str


# ============================================================================
# Parsing
# ============================================================================

def parse_exam_credit_page(html: str) -> ExamCreditPage:
    """Pure parse: HTML in, award rows out."""
    soup = BeautifulSoup(html, "html.parser")
    year = catalog.catalog_year_of(soup)
    for sup in soup.find_all("sup"):
        mark = sup.get_text(strip=True)
        if mark:
            sup.replace_with(_FN_SENTINEL.format(mark))
        else:
            sup.decompose()

    awards: list[ExamAward] = []
    seen_ids: set[str] = set()
    for family, spec in FAMILIES.items():
        table = next((t for t in soup.find_all("table") if spec.header.lower() in _heading_of(t).lower()), None)
        if table is None:
            log.warning("no table found for %s (heading containing %r)", family, spec.header)
            continue
        before = len(awards)
        awards.extend(_parse_table(family, spec, table, seen_ids))
        log.debug("%s: %d awards", family, len(awards) - before)
    return ExamCreditPage(year, awards)


def _parse_table(family: str, spec: FamilySpec, table: Tag, seen_ids: set[str]) -> list[ExamAward]:
    fn_words = _footnote_words(table)
    rows = [[c.get_text(" ", strip=True).replace("\xa0", " ") for c in tr.find_all(["td", "th"])]
            for tr in table.find_all("tr")]
    if not rows:
        return []
    gened_col = next((i for i, h in enumerate(rows[0]) if "gen ed" in h.lower()), None)

    # The first body row is usually the "3 Credits/Exam unless..." note: it
    # has no exam name. Read its per-column defaults, then skip it.
    body = rows[1:]
    noted: dict[int, int] = {}
    if body and not body[0][0].strip():
        noted = _column_defaults(body[0])
        body = body[1:]

    awards: list[ExamAward] = []
    for cells in body:
        title = _strip_fn(cells[0])
        if not title:
            continue
        exams = _split_titles(title) if spec.split_titles else [title]

        bands = spec.bands
        if spec.score_col is not None:  # CLEP: the score is a cell
            idx = 1 + spec.score_col
            score = _score_of(cells[idx]) if idx < len(cells) else None
            if score is None:  # "None": this row grants nothing
                continue
            bands = tuple((score, score, label, col) for _, _, label, col in bands)

        exam_words = _cell_words(cells[0], fn_words)
        by_course, row_areas = (_parse_gened_cell(cells[gened_col])
                                if gened_col is not None and gened_col < len(cells) else ({}, set()))

        # Collapse adjacent score bands that grant exactly the same thing
        # (Calculus AB: MAC 2311 for 3, 4 and 5 becomes one 3-5 row).
        grants: list[_Grant] = []
        for lo, hi, label, col in bands:
            idx = 1 + col
            if idx >= len(cells) or not cells[idx].strip() or _NA_RE.fullmatch(cells[idx].strip()):
                continue
            cell = cells[idx]
            course_ids = tuple(ids.find_course_ids(_strip_fn(cell)))
            credits, source = _credits(cell, col, noted, spec.assumed)
            grant = _Grant(lo, hi, label, course_ids, credits, source,
                           _cell_words(cell, fn_words) or exam_words, bool(_XUF_RE.search(cell)),
                           " ".join(_strip_fn(cell).split()))
            # Same grant = same courses, credits, words and XUF flag. Where it
            # came from may differ (UF printed "(3 credits)" on only one of two
            # identical columns), so the merged row keeps the strongest source.
            prev = grants[-1] if grants else None
            if (prev and label is None
                    and (prev.ids, prev.credits, prev.words, prev.xuf) == (grant.ids, grant.credits, grant.words, grant.xuf)):
                source = min(prev.source, grant.source, key=_SOURCE_STRENGTH.index)
                grants[-1] = prev._replace(hi=hi, source=source)
            else:
                grants.append(grant)

        for g in grants:
            # L000 elective credit never counts for Gen Ed; XUF explicitly does.
            areas: set[str] = set()
            if g.ids or g.xuf:
                areas |= row_areas
                for cid in g.ids:
                    areas |= by_course.get(cid, set())
            for exam in exams:
                base = _slug(family, exam, g.label or f"{g.lo}-{g.hi}")
                award_id, n = base, 1
                while award_id in seen_ids:  # UF lists one exam twice with two awards
                    n += 1
                    award_id = f"{base}-{n}"
                seen_ids.add(award_id)
                awards.append(ExamAward(
                    id=award_id, family=family, exam=exam, min_score=g.lo, max_score=g.hi,
                    score_label=g.label or "", course_ids=list(g.ids), credits=g.credits,
                    credits_source=g.source, gen_ed=sorted(areas), writing_words=g.words,
                    award_text=g.text,
                ))
    return awards


def apply_course_credits(awards: list[ExamAward], course_credits: dict[str, float]) -> int:
    """Replace the family default on "assumed" awards that name courses with
    the sum of those courses' catalog minimum credits. An award naming a
    course the catalog lacks keeps the default. Returns how many changed value."""
    changed = 0
    for a in awards:
        if a.credits_source != "assumed" or not a.course_ids:
            continue
        if not all(cid in course_credits for cid in a.course_ids):
            continue
        credits = int(sum(course_credits[cid] for cid in a.course_ids))
        changed += credits != a.credits
        a.credits, a.credits_source = credits, "assumed_course"
    return changed


# ============================================================================
# Cell helpers
# ============================================================================

def _credits(cell: str, col: int, noted: dict[int, int], assumed: dict[int, int]) -> tuple[int, str]:
    if m := _CREDITS_RE.search(cell):
        return sum(int(n) for n in re.findall(r"\d+", m.group(1))), "explicit"
    if col in noted:
        return noted[col], "table_note"
    return assumed.get(col, 3), "assumed"


def _column_defaults(note_row: list[str]) -> dict[int, int]:
    defaults: dict[int, int] = {}
    for i, cell in enumerate(note_row[1:]):
        if m := _DEFAULT_CREDITS_RE.search(cell):
            defaults[i] = int(m.group(1) or m.group(2))
    return defaults


def _heading_of(table: Tag) -> str:
    heading = table.find_previous(["h1", "h2", "h3", "h4"])
    return heading.get_text(strip=True) if heading else ""


def _split_titles(title: str) -> list[str]:
    """Split on TOP-LEVEL commas only, so 'Arabic (Algerian, MSA, Saudi)'
    stays one exam while 'Albanian, Azerbaijani, Cebuano' becomes three."""
    parts, depth, current = [], 0, ""
    for ch in title:
        depth += (ch == "(") - (ch == ")" and depth > 0)
        if ch == "," and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += ch
    parts.append(current)
    return [p for p in (" ".join(x.split()) for x in parts) if p]


def _score_of(cell: str) -> int | None:
    m = _SCORE_RE.search(_strip_fn(cell))
    return int(m.group(0)) if m else None


def _strip_fn(text: str) -> str:
    return _FN_RE.sub("", text).strip()


def _footnote_words(table: Tag) -> dict[str, int]:
    """Footnote marker -> writing words, from the footnote list right after
    THIS table. A table with no footnotes must not borrow the next table's:
    same marker numbers, different meanings."""
    words: dict[str, int] = {}
    dl = table.find_next("dl", class_="sc_footnotes")
    if dl is None or dl.find_previous("table") is not table:
        return words
    for dt, dd in zip(dl.find_all("dt"), dl.find_all("dd")):
        if m := _FN_WORDS_RE.search(dd.get_text(" ", strip=True)):
            raw = dt.get_text(strip=True)
            sentinel = _FN_RE.search(raw)
            words[sentinel.group(1) if sentinel else raw] = int(m.group(1).replace(",", ""))
    return words


def _cell_words(cell: str, fn_words: dict[str, int]) -> int:
    """Writing words an award grants: one per writing footnote marker in the
    cell ('ENC 1101‡fn2‡ and ENC 1102‡fn2‡' -> 12000)."""
    return sum(fn_words.get(m, 0) for m in _FN_RE.findall(cell))


def _parse_gened_cell(text: str) -> tuple[dict[str, set[str]], set[str]]:
    """Gen Ed column -> (course id -> areas, areas for the whole row).

    Observed notation: 'CHM 1020, 2045 = State Core P, CHM 2045L = P',
    'REL 2300 = H and N', bare 'State Core M' (row-level). Bare numbers inherit
    the previous prefix; parentheticals are notes and are ignored."""
    text = _PARENS_RE.sub(" ", _strip_fn(text.replace("\xa0", " ")))
    by_course: dict[str, set[str]] = {}
    row_level: set[str] = set()
    subject, group, assigning = "", [], False
    for m in _GENED_TOKEN_RE.finditer(text):
        full_subject, full_number, bare_number, letter, _ = m.groups()
        if full_subject or bare_number:
            if assigning:  # a new course group starts after a run of letters
                group, assigning = [], False
            if full_subject:
                subject = full_subject
            if subject:
                group.append(ids.code_to_id(subject + (full_number or bare_number)))
        elif letter:
            area = ids.gen_ed_from_letter(letter)
            if group:
                assigning = True
                for cid in group:
                    by_course.setdefault(cid, set()).add(area)
            else:
                row_level.add(area)
    return by_course, row_level


def _slug(*parts: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", "-".join(parts).lower()).strip("-")
