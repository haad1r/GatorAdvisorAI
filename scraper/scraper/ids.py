"""Shared identities and vocabularies: course ids, term codes, Gen Ed areas.

Every module that turns UF text into data imports from here, so the catalog,
SOC and exam-credit pipelines all produce the SAME ids and the SAME labels.
Each function either returns a canonical value or None for input it does not
recognize. Callers must log the None case: an unrecognized label is a sign
UF changed something, never something to drop silently.
"""

from __future__ import annotations

import re

# ============================================================================
# Course ids
# ============================================================================
# A UF course code is a 3-letter prefix, a 4-digit number, and an optional
# letter suffix ("C" = combined lecture+lab, "L" = lab): "COP 3502C".
# Our id is the same thing lowercase with no spaces: "cop3502c". It is the
# join key across every CSV and, later, every database table.

COURSE_ID_RE = re.compile(r"^[a-z]{3}\d{4}[a-z]?$")
_CODE_IN_TEXT_RE = re.compile(r"\b([A-Z]{3})\s?(\d{4}[A-Z]?)\b")


def code_to_id(code: str) -> str:
    """'COP 3502C', 'COP3502C', 'cop 3502c' -> 'cop3502c'."""
    return re.sub(r"\s+", "", code).lower()


def id_to_code(course_id: str) -> str:
    """'cop3502c' -> 'COP 3502C' (UF's display form)."""
    return f"{course_id[:3].upper()} {course_id[3:].upper()}"


def is_course_id(value: str) -> bool:
    return bool(COURSE_ID_RE.match(value))


def find_course_ids(text: str) -> list[str]:
    """Every course code mentioned in free text, as ids, in order of first
    appearance, without repeats. Codes must be uppercase, as UF writes them,
    so ordinary words never match."""
    return list(dict.fromkeys(code_to_id(m.group(1) + m.group(2))
                              for m in _CODE_IN_TEXT_RE.finditer(text)))


def course_level(course_id: str) -> int:
    """First digit of the number: 1-4 undergraduate, 5-7 graduate/professional."""
    return int(course_id[3])


# ============================================================================
# Term codes
# ============================================================================
# UF's Schedule of Courses names a term with 4 characters:
#   "2" (the 2000s) + two-digit year + the month the term starts
#   (1 = January/spring, 5 = May/summer, 8 = August/fall)
# so Fall 2021 = "2218", Spring 2027 = "2271". All codes have the same length,
# which means plain string comparison sorts them chronologically.
# SOC also lists summer sub-terms ("22656W1"); those are not main terms.

SEASON_DIGITS = {"spring": "1", "summer": "5", "fall": "8"}
_DIGIT_SEASONS = {digit: season for season, digit in SEASON_DIGITS.items()}
TERM_CODE_RE = re.compile(r"^2\d\d[158]$")


def is_term_code(code: str) -> bool:
    return bool(TERM_CODE_RE.match(code))


def term_code(year: int, season: str) -> str:
    """(2021, 'fall') -> '2218'."""
    return f"2{year % 100:02d}{SEASON_DIGITS[season]}"


def term_season(code: str) -> str:
    """'2218' -> 'fall'."""
    return _DIGIT_SEASONS[code[3]]


def term_year(code: str) -> int:
    """'2218' -> 2021."""
    return 2000 + int(code[1:3])


def term_name(code: str) -> str:
    """'2218' -> 'Fall 2021'."""
    return f"{term_season(code).title()} {term_year(code)}"


def next_term(code: str) -> str:
    """spring -> summer -> fall -> next spring."""
    year, season = term_year(code), term_season(code)
    if season == "spring":
        return term_code(year, "summer")
    if season == "summer":
        return term_code(year, "fall")
    return term_code(year + 1, "spring")


def terms_between(first: str, last: str) -> list[str]:
    """Every main term from first through last, inclusive, in order."""
    if not (is_term_code(first) and is_term_code(last)):
        raise ValueError(f"not main term codes: {first!r}, {last!r}")
    terms = []
    code = first
    while code <= last:
        terms.append(code)
        code = next_term(code)
    return terms


# ============================================================================
# General Education vocabulary
# ============================================================================
# One canonical code per area. UF spells each area differently depending on
# the source, so every spelling we have actually observed maps here.

GEN_ED_AREAS = (
    "composition", "humanities", "mathematics", "biological",
    "physical", "social", "diversity", "international",
)
QUEST_LEVELS = ("quest1", "quest2", "quest3")

# Lowercased labels -> canonical area. Sources:
#   SOC section "genEd" list:  "Biological Science", "Social Science", ...
#   Catalog Attributes line:   "General Education - Biological Science"
#                              (callers strip the "General Education - " part)
_GEN_ED_LABELS = {
    "composition": "composition",
    "humanities": "humanities",
    "mathematics": "mathematics",
    "biological science": "biological",
    "biological sciences": "biological",
    "physical science": "physical",
    "physical sciences": "physical",
    "social science": "social",
    "social sciences": "social",
    "social and behavioral science": "social",
    "social and behavioral sciences": "social",
    "diversity": "diversity",
    "international": "international",
}

# Single letters used by the exam-credit tables ("State Core P").
_GEN_ED_LETTERS = {
    "B": "biological", "C": "composition", "D": "diversity", "H": "humanities",
    "M": "mathematics", "N": "international", "P": "physical", "S": "social",
}

# SOC: "QUEST 1". Catalog: "Quest 1", and "3rd Year UF Quest" for Quest 3.
_QUEST_RE = re.compile(r"^(?:quest\s*([123])|([123])(?:st|nd|rd)\s+year\s+uf\s+quest)$", re.IGNORECASE)


def gen_ed_from_label(label: str) -> str | None:
    """'Biological Science' -> 'biological'; None if unrecognized."""
    return _GEN_ED_LABELS.get(" ".join(label.split()).lower().rstrip("."))


def gen_ed_from_letter(letter: str) -> str | None:
    """'P' -> 'physical'; None if unrecognized."""
    return _GEN_ED_LETTERS.get(letter.strip().upper())


def quest_from_label(label: str) -> str | None:
    """'QUEST 2' -> 'quest2', '3rd Year UF Quest' -> 'quest3'; None if unrecognized."""
    m = _QUEST_RE.match(" ".join(label.split()))
    return f"quest{m.group(1) or m.group(2)}" if m else None