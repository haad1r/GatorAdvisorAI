"""Parse UF catalog program pages into program/requirement/plan records.

Ported from uf-planner (scraper/scraper/programs.py) with its parsing logic
unchanged: these heuristics were tuned page by page against the catalog, and
every special case below cites the program that needed it. Only the imports
changed (course ids come from ids.py).

Best-effort parsing of CourseLeaf program pages (the same generator behind
the department pages parse.py handles). Two structures matter:

- ``table.sc_courselist`` — the requirement table. ``areaheader`` rows start
  a group; plain rows are required slots; ``orclass`` rows attach an
  alternative to the previous slot ("or ENC 2256"); "A & B" rows require
  both courses (one slot each); free-text rows become placeholder slots and
  are NEVER silently dropped — they lower the QA confidence score instead.
  A "Select from:"/"Select N ..." comment row (or a credit-bearing header
  with no required rows) turns its group into choose_credits/choose_n.
- ``table.sc_plangrid`` — the model semester plan. ``plangridterm`` rows
  advance the semester counter; course rows keep their Critical Tracking
  flag; anything that isn't a course code ("State Core Gen Ed Humanities")
  becomes a placeholder row.

Everything unparseable stays visible: groups carry their source rows'
raw_html, and per-program corrections live in program_overrides/<id>.json
(applied in overrides.py style after parsing).
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field

from bs4 import BeautifulSoup, Tag

from .ids import code_to_id

# A course code with its two parts as groups (prefix, number): "COP 3502C".
# The program parser reads the parts separately ("PHY 2048 & 2048L" reuses
# the prefix), so it keeps its own pattern rather than ids.find_course_ids.
COURSE_CODE_RE = re.compile(r"\b([A-Z]{3})\s?(\d{4}[A-Z]?)\b")

log = logging.getLogger("scraper.programs")

# "/search/?P=COP%203502C"-style course links inside courselist cells.
SEARCH_HREF_RE = re.compile(r"/search/\?P=([A-Z]{3})%20(\d{4}[A-Z]?)")
# "PHY 2048 & 2048L" — the continuation shares the letter prefix.
AMP_CONT_RE = re.compile(r"&\s*(\d{4}[A-Z]?)\b")
# Matches both program pages (/UGRD/colleges-schools/UGENG/CPS_BSCS/) and
# track/specialization subpages (/UGRD/colleges-schools/UGAGL/ANS_BS/ANS_BS01/);
# the last path segment is the program code either way. The college segment is
# case-insensitive: every legacy slug is all-caps (UGENG) but the Hamilton
# School's is lowercase (hamilton), and [A-Z]+ silently dropped all nine of its
# programs from the index parse — the same class of bug as DEPT_HREF_RE's
# [a-z0-9_] charset, which hid hyphenated department slugs until 2026-07-26.
PROGRAM_URL_RE = re.compile(r"/UGRD/colleges-schools/([A-Za-z]+)/(?:[A-Za-z0-9_]+/)*([A-Za-z0-9_]+)/?$")
CREDITS_CELL_RE = re.compile(r"(\d+(?:\.\d+)?)")
# Changed from UF Planner: pages also say "Select at least two", "Select a
# minimum of 3 credits", "Choose One" and "Select six" (evh_umn, las_uct02,
# hll_ba01, fes_bsfe_ufo). Missed, the row became a placeholder and the
# chooser's options were absorbed into the list above as "take all".
SELECT_N_RE = re.compile(
    r"(?:select|choose)\s+(?:at\s+least\s+|(?:a\s+)?minimum\s+of\s+)?"
    r"(one|two|three|four|five|six|seven|eight|nine|ten|\d+)", re.IGNORECASE)
# Where a body row's instruction may begin: the start of the row, or right after
# a clause boundary ("Specialization; Select three:", "Proficiency through
# precalculus is required. Select ONE option below.", "Chinese Language (select
# one)", "And, select one:"). A mid-sentence "select" ("students may select up to 9 credits",
# "FYCS undergraduate course – select one course") stays free text.
INSTRUCTION_START_RE = re.compile(r"(?:^|[;.,(]\s*)(?:select|choose)\b", re.IGNORECASE)
# "Select at most one" / "Select a maximum of one:" caps a list; it asks for
# nothing, so it never opens a chooser, and the courses under it are not the
# options of a row above it (eco_ba: "Four economics elective courses 15-16"
# then "Select a maximum of one:" over four non-ECO courses; lin_ba's "Select
# up to 6 credits of one of the following:").
AT_MOST_RE = re.compile(r"\b(?:at\s+most|(?:a\s+)?maximum\s+of|up\s+to)\b", re.IGNORECASE)
# "Select at least one course from each:" / "from two of three groups" spreads
# a requirement over the sub-areas that follow (psy_bs03, bio_bs03): each area is
# its own requirement, not one alternative of a single chooser. Left as text.
# "Select three of the following groups and take one course from each:"
# (agl_uct20) chooses AMONG the groups, so it stays a chooser.
DISTRIBUTION_RE = re.compile(r"\bfrom\s+(?:each\b|\w+\s+of\s+(?:the\s+)?\w+\s+(?:groups?|areas?|categories)\b)",
                             re.IGNORECASE)
CHOOSE_GROUPS_RE = re.compile(r"select\s+\w+\s+of\s+the\s+following\s+(?:groups|areas|categories)\b", re.IGNORECASE)
# "Select one option", "Option A", "Logic Option" — a chooser whose choices are
# spelled out as follow-on "* Option" sub-headers rather than inline courses.
OPTION_RE = re.compile(r"\boptions?\b", re.IGNORECASE)
# "Total Credits" / "Total Major Coursework" / "Total ... Credits" summary rows.
# The catalog marks these areaheader (not listsum) on some pages, so without
# this guard they parse as phantom requirement groups carrying the subtotal as
# their credit count (e.g. International Studies' "Total ... Major Credits" +
# "Total Credits" = a +72 cr double-count that made the plan infeasible).
TOTAL_HEADER_RE = re.compile(r"^\s*total\b", re.IGNORECASE)
# "Recommended Coursework" / "Recommended Electives" — optional SUGGESTIONS
# (grad-school prep, a suggested minor), NOT degree requirements. UF puts these
# under their own <h2> with a headerless courselist table, which otherwise
# parses into a phantom required "Requirements" group carrying the whole
# suggested block as required (the eco_ba bug: a recommended math sequence —
# differential equations, linear algebra, real analysis — demanded of every
# Economics BA). Skipped wherever it appears: a table heading (parse_program_page)
# or an in-table areaheader (below). The planner requires every group regardless
# of section, so these must be dropped rather than merely labelled.
RECOMMENDED_RE = re.compile(r"\brecommended\b", re.IGNORECASE)
# ...unless the same heading calls the list APPROVED (s92). Botany BS02
# (UGLAS) prints its approved electives under "Recommended and Approved
# Electives", the one such heading in the cache, and its "Botany Electives" row
# points at that list ("... or from the list of approved electives"). Skipping
# it left the row with nothing to count. A list UF approves is one a
# requirement draws on, so it is parsed like any other; build_data's sanitizer
# and `_TAB_LIST_POOLS` decide what it becomes.
APPROVED_RE = re.compile(r"\bapproved\b", re.IGNORECASE)


def _recommended_only(text: str) -> bool:
    """A "Recommended ..." heading that is suggestions, not requirements."""
    return RECOMMENDED_RE.search(text) is not None and APPROVED_RE.search(text) is None

# A body row that restates a subtotal of courses ALREADY listed above
# ("Required Major Coursework (from the table above)  41-46") is a summary line,
# not a requirement. Left in, it becomes a phantom slot whose credits
# double-count the whole table (gpy_ba01: +44 cr on a 41-cr major). Skipped like
# a "Total" row, but recognised by its self-reference since it isn't headed
# "Total".
SUBTOTAL_REF_RE = re.compile(r"from the table above", re.IGNORECASE)
# A plan grid this long enumerates the whole curriculum, so a redundant
# by-department elective course-list table can be skipped in its favour.
SUBSTANTIAL_GRID = 20
# "credits" right after the number means it counts hours, not courses
# ("Select 9 credits", "Select 3 to 6 credits").
CREDITS_AFTER_RE = re.compile(r"^(?:(?:to|-|–)\s*\d+\s*)?credits?\b", re.IGNORECASE)
WORD_NUMBERS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
                "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}


REQUIRED_CREDITS_RE = re.compile(r"^(\d+(?:\.\d+)?)\s+required\s+credits?\b", re.IGNORECASE)


def _parse_select(text: str, anchored: bool = True) -> dict | None:
    """Parse a "Select ..." instruction row. Returns None for ordinary text,
    else {"n": course-count or None, "credits": hours or None}.

    anchored: body rows are instructions only when "Select"/"Choose" starts the
    row or a clause of it (INSTRUCTION_START_RE; changed from UF Planner, which
    required the row to start with "Select") — mid-sentence matches ("FYCS
    undergraduate course — select one course") are free-text requirements.
    Header text is parsed unanchored ("Section 1: ...; select 1 course")."""
    stripped = text.lstrip()
    m = REQUIRED_CREDITS_RE.match(stripped)
    if m:  # "1 required credit; select from:" / "2 required credits"
        return {"n": None, "credits": float(m.group(1))}
    # "select from" is an instruction even mid-row ("Or select from Approved
    # list 2", eus_umn: the only such row on the 2026-27 pages), so it is
    # matched before the anchored check, deliberately.
    if re.search(r"select\s+from", text, re.IGNORECASE):
        return {"n": None, "credits": None}
    if anchored and not INSTRUCTION_START_RE.search(stripped):
        return None
    # Body rows only: a header that distributes ("Select three of the following
    # groups and take one course from each:", agl_uct20) names its own chooser.
    if anchored and DISTRIBUTION_RE.search(text) and not CHOOSE_GROUPS_RE.search(text):
        return None
    m = SELECT_N_RE.search(text)
    if m:
        token = m.group(1).lower()
        num = WORD_NUMBERS.get(token) or (int(token) if token.isdigit() else None)
        if CREDITS_AFTER_RE.match(text[m.end():].lstrip()):
            return {"n": None, "credits": float(num) if num is not None else None}
        return {"n": num, "credits": None}
    return None


@dataclass
class ProgramRecord:
    id: str                      # "ugeng-cps_bscs"
    name: str
    kind: str = "major"          # major | minor | certificate
    degree: str | None = None    # "BSCS"
    college_slug: str | None = None
    url: str | None = None
    catalog_year: str | None = None


@dataclass
class RequirementGroupRow:
    group_key: str
    name: str
    rtype: str                   # required_list | choose_n | choose_credits
    logic: dict
    eligible_course_ids: list[str]
    required_credits: float | None
    required_course_count: int | None
    sort_order: int
    section: str
    raw_html: str


@dataclass
class PlanRow:
    semester_index: int
    position: int
    course_id: str | None
    placeholder: str | None
    credits: float | None
    is_critical_tracking: bool
    is_summer: bool = False  # summers don't advance critical-tracking milestones
    # A CHOICE the grid prints (s94). Rows sharing `alt_group` (numbered per
    # grid) are one choice; `alt_option` says which option a row is part of.
    # Option 0 is the choice's header row ("Select one:", which carries its
    # credits); options 1..n are the alternatives, and a multi-course option
    # ("CHM 2045 & 2045L") is several rows with ONE option number. Both None
    # for an ordinary row. Before s94 "CGN 2328 or EML 2023" and "CHM 2045 &
    # 2045L" parsed to indistinguishable rows.
    alt_group: int | None = None
    alt_option: int | None = None


@dataclass
class MilestoneRow:
    """One "Semester N" critical-tracking milestone. kind:
    - count  : complete `count` of the tracking pool by this semester (cumulative
               across semesters; -1 = all of pool). `pool` = enumerated ids, or
               [] meaning "resolve from the program's critical-tracking plan rows".
    - courses: `slots` = [[[ids…], …], …] — one slot per required course, each a
               list of ` or `-alternatives, each alternative a `/`-joined AND-set.
    - note   : unparseable/GPA text the engine ignores (kept for transparency)."""
    semester: int
    kind: str
    slots: list = field(default_factory=list)
    count: int | None = None
    pool: list[str] = field(default_factory=list)
    raw_text: str = ""


@dataclass
class ParsedProgram:
    program: ProgramRecord
    groups: list[RequirementGroupRow] = field(default_factory=list)
    plan: list[PlanRow] = field(default_factory=list)
    milestones: list[MilestoneRow] = field(default_factory=list)
    total_credits: float | None = None  # the courselist's "Total Credits" row
    # group_keys of the table that carried the Total Credits row. Multi-table
    # pages put elective options / "Recommended Coursework" in listsum-less
    # tables that the stated total does not cover, so QA's credit check must
    # only sum these groups.
    total_credit_keys: list[str] = field(default_factory=list)
    # page_fingerprint(html): changes only when UF edits the program's content,
    # so a program override can tell it was reviewed against an older page.
    fingerprint: str = ""
    override_reason: str = ""  # set by qa.apply_program_overrides


def _cell_text(el: Tag) -> str:
    """Cell text with footnote markers dropped and nbsp normalized."""
    for sup in el.find_all("sup"):
        sup.decompose()
    return " ".join(el.get_text(" ", strip=True).replace("\xa0", " ").split())


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "group"


def _cell_credits(text: str) -> float | None:
    """Hours-cell value; ranges ("3-4") keep the low end."""
    m = CREDITS_CELL_RE.search(text)
    return float(m.group(1)) if m else None


def _codes_in_cell(td: Tag) -> list[str]:
    """Course ids in a codecol cell, in document order.

    Links are authoritative ("/search/?P=COP%203502C"); "& 2048L"-style
    continuations reuse the previous code's letter prefix and usually have
    no link of their own.
    """
    return _codes_in_text(_cell_text(td))


def _codes_in_text(text: str) -> list[str]:
    """`_codes_in_cell` over already-extracted cell text (one "or" arm of it)."""
    ids: list[str] = []
    for m in COURSE_CODE_RE.finditer(text):
        ids.append(code_to_id(f"{m.group(1)}{m.group(2)}"))
    prefix = ids[-1][:3] if ids else None
    for m in AMP_CONT_RE.finditer(text):
        cont = code_to_id(f"{prefix}{m.group(1)}") if prefix else None
        if cont and cont not in ids:
            ids.append(cont)
    # De-dupe, preserving order (a code can appear in both link and text).
    seen: set[str] = set()
    return [i for i in ids if not (i in seen or seen.add(i))]


def _classify_section(name: str) -> str:
    lowered = name.lower()
    if "gen ed" in lowered or "general education" in lowered:
        return "geneed"
    if "tracking" in lowered:
        return "tracking"
    return "major"


# --- Heading / intro awareness (a courselist table's requirement semantics live
# in the <h2>/<h3> above it and its intro <p>, which parse_courselist otherwise
# never sees: "Technical Electives", "Aerospace Electives | Select Two",
# "Students may take any three courses ... do not indicate required
# distributions"). ---
_ELECTIVE_HEADING_RE = re.compile(r"electives?\b", re.IGNORECASE)
_ELECTIVE_INTRO_RE = re.compile(
    r"may take any|do not indicate required|from the lists below", re.IGNORECASE
)
_CREDITS_IN_NAME_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:credits?|hours?)\b", re.IGNORECASE)


def _preceding_heading(table: Tag) -> str:
    """The nearest heading above the table ON THE SAME TAB (changed from UF
    Planner): the first table of an "Approved Electives" tab has no heading of
    its own, and walking back across tabs named it after the model plan's last
    "Semester 8" heading."""
    h = table.find_previous(re.compile(r"^h[2-6]$"))
    if h is None:
        return ""
    container = table.find_parent(id=lambda v: bool(v) and v.endswith("textcontainer"))
    if container is not None and container not in h.parents:
        return ""
    return _cell_text(h)


def _preceding_intro(table: Tag) -> str:
    """The nearest non-empty <p>/<div> text directly above the table (its
    descriptive lede), searched back a few siblings."""
    node = table.previous_sibling
    for _ in range(6):
        if isinstance(node, Tag) and node.name in ("p", "div"):
            txt = _cell_text(node)
            if txt:
                return txt
        node = node.previous_sibling if node is not None else None
    return ""


def _is_elective_context(heading: str, intro: str) -> bool:
    """True when the heading/intro marks the whole table as an elective POOL —
    its course lists are options, not required (aro 'Technical Electives',
    sst 'do not indicate required distributions')."""
    return bool(_ELECTIVE_HEADING_RE.search(heading) or _ELECTIVE_INTRO_RE.search(intro))


def _plain_areaheaders(table: Tag) -> int:
    """Count areaheaders that are pure OPTION lists — they own course rows but
    no hourscol credit and no 'Select' instruction — i.e. the ones that wrongly
    become independent required_list groups (aro's 18 departments)."""
    rows = table.find_all("tr")
    count = 0
    for i, tr in enumerate(rows):
        if "areaheader" not in tr.get("class", []):
            continue
        name = _cell_text(tr)
        if re.match(r"(?i)\s*(select|total)", name) or _CREDITS_IN_NAME_RE.search(name):
            continue
        hrs = tr.find("td", class_="hourscol")
        if hrs and hrs.get_text(strip=True):
            continue
        has_course = has_select = False
        for tr2 in rows[i + 1 :]:
            if "areaheader" in tr2.get("class", []):
                break
            code = tr2.find("td", class_="codecol")
            if code and code.get_text(strip=True):
                has_course = True
            if re.match(r"(?i)\s*select\b", _cell_text(tr2)):
                has_select = True
        if has_course and not has_select:
            count += 1
    return count


class _GroupBuilder:
    """Accumulates one areaheader's rows, then emits a RequirementGroupRow."""

    def __init__(self, name: str, header_credits: float | None, sort_order: int) -> None:
        self.name = name
        self.header_credits = header_credits
        self.sort_order = sort_order
        self.slots: list[dict] = []       # {"ids": [...], "credits": float|None} or {"placeholder": str}
        self.choose_n: int | None = None  # set by a "Select one ..." comment row
        self.is_choose = False            # set by any "Select ..." comment row
        self.saw_indent = False           # a chooser whose options are
                                          # blockindent rows ends at the first
                                          # non-indented row
        self.collecting_options = False   # a "Select N options" chooser whose
                                          # choices are follow-on "* Option"
                                          # sub-headers to be absorbed
        self.skip = False                 # a "Recommended Coursework" areaheader:
                                          # absorb its rows so parsing continues,
                                          # but emit no group (it's not required)
        self.end_on_hours = False         # a chooser opened by an instruction row
                                          # whose options carry no hours: the
                                          # first later row WITH hours is the next
                                          # requirement, not another option
        self.raw_rows: list[str] = []

    def add_course_slot(self, ids: list[str], credits: float | None) -> None:
        self.slots.append({"ids": ids, "credits": credits})

    def extend_last_slot(self, ids: list[str]) -> None:
        for slot in reversed(self.slots):
            if "ids" in slot:
                slot["ids"].extend(i for i in ids if i not in slot["ids"])
                return
        # An orclass row with nothing to attach to — keep it visible.
        self.slots.append({"placeholder": "or " + " / ".join(ids)})

    def add_placeholder(self, text: str, credits: float | None = None,
                        select: dict | None = None) -> None:
        # `select`: an instruction parse_courselist already recognised (also
        # from the row's shape, which the text alone cannot show).
        select = select or _parse_select(text)
        if select:  # instruction row, not a requirement of its own
            self.is_choose = True
            if select["n"] is not None:
                self.choose_n = select["n"]
            header = select["credits"] if select["credits"] is not None else credits
            if header is not None and self.header_credits is None:
                self.header_credits = header
            # "Select one option ..." -> absorb sub-headers. Only when the row
            # starts with the instruction: "... is required. Select ONE option
            # below." (psy_bs02) lists plain courses, not "Option A/B" headers.
            if OPTION_RE.search(text) and re.match(r"(?i)\s*(?:select|choose)\b", text):
                self.collecting_options = True
            return
        # Free-text rows keep their hours ("Approved electives  9") so the
        # group's required_credits matches the table's stated total.
        self.slots.append({"placeholder": text, "credits": credits})

    def build(self, used_keys: set[str]) -> RequirementGroupRow:
        key = _slugify(self.name)
        while key in used_keys:  # duplicate header names get -2, -3, ...
            m = re.match(r"(.*?)(?:-(\d+))?$", key)
            key = f"{m.group(1)}-{int(m.group(2) or 1) + 1}"
        used_keys.add(key)

        course_slots = [s for s in self.slots if "ids" in s]
        flat: list[str] = []
        for slot in course_slots:
            flat.extend(i for i in slot["ids"] if i not in flat)

        # Option buckets: a chooser whose choices are spelled out as "Option A /
        # Option B / …" labels, each followed by that option's courses. Emit
        # logic.options (one id list per option) so the planner picks ONE
        # complete option instead of mixing courses across them (e.g. the
        # liberal-arts physics with-calc vs without-calc tracks). Walk the slots
        # in order, opening a new bucket at each "Option" placeholder.
        buckets: list[tuple[str, list[str]]] = []
        current: list[str] | None = None
        for s in self.slots:
            if "placeholder" in s and OPTION_RE.search(s["placeholder"]):
                current = []
                buckets.append((s["placeholder"], current))
            elif "ids" in s and current is not None:
                current.extend(i for i in s["ids"] if i not in current)
        buckets = [(label, ids) for label, ids in buckets if ids]
        # Changed from UF Planner: a chooser whose alternatives are split by
        # bare "OR" rows (each side may be an "&" bundle: "SPN 2240 & SPN 3300
        # / OR / SPN 2340 & SPN 3350" on hll_ba01) has one option per side, so
        # the planner never mixes courses from both.
        is_or = lambda s: "placeholder" in s and s["placeholder"].strip().upper() == "OR"
        if self.is_choose and not buckets and any(is_or(s) for s in self.slots):
            sides: list[list[str]] = [[]]
            for s in self.slots:
                if is_or(s):
                    sides.append([])
                elif "ids" in s:
                    sides[-1].extend(i for i in s["ids"] if i not in sides[-1])
            if all(sides) and len(sides) >= 2:
                self.slots = [s for s in self.slots if not is_or(s)]
                buckets = [(f"Option {n}", ids) for n, ids in enumerate(sides, 1)]
        if len(buckets) >= 2:
            return RequirementGroupRow(
                group_key=key,
                name=self.name,
                rtype="choose_credits",
                logic={
                    "options": [ids for _, ids in buckets],
                    "option_labels": [label for label, _ in buckets],
                    "credits": self.header_credits,
                },
                eligible_course_ids=flat,
                required_credits=self.header_credits,
                required_course_count=self.choose_n,
                sort_order=self.sort_order,
                section=_classify_section(self.name),
                raw_html="\n".join(self.raw_rows),
            )

        # A group that only lists options (or lists nothing at all) under a
        # credit-bearing header is a chooser, even without a "Select" row.
        is_choose = self.is_choose or (self.header_credits is not None and not course_slots)
        # Changed from UF Planner: an elective-named header with credits over
        # several courses that carry no hours of their own ("Electives 9" then
        # 13 courses on plb_umn) is a pool to choose from, not a list to take.
        if (not is_choose and self.header_credits and len(course_slots) >= 2
                and not any(s.get("credits") for s in course_slots)
                and _ELECTIVE_HEADING_RE.search(self.name)):
            is_choose = True

        if is_choose:
            if self.choose_n is not None and self.header_credits is None:
                rtype = "choose_n"
                logic: dict = {"from": flat, "n": self.choose_n}
            else:
                rtype = "choose_credits"
                logic = {"from": flat, "credits": self.header_credits}
            # A credit-bearing chooser whose options aren't in the table (they
            # live in prose / an advisor's approved list) is a valid open
            # elective slot, not a broken group — flag it so QA warns instead
            # of erroring and the planner renders "N credits of ..." open.
            if not flat and self.header_credits is not None:
                logic["open_electives"] = True
            required_credits = self.header_credits
            required_count = self.choose_n
        else:
            rtype = "required_list"
            logic = {
                "slots": [
                    # A placeholder keeps its hours ("Approved electives  9") so
                    # link_option_pools can hand them to the pool it names.
                    s["ids"] if "ids" in s else
                    {"placeholder": s["placeholder"],
                     **({"credits": s["credits"]} if s.get("credits") is not None else {})}
                    for s in self.slots
                ]
            }
            # None-credit slots are "& 2048L" continuations whose hours are
            # bundled into the preceding slot, so they sum as zero. Placeholder
            # slots with hours ("Approved electives  9") count toward the total.
            slot_credits = [s["credits"] for s in self.slots if s.get("credits") is not None]
            required_credits = sum(slot_credits) if slot_credits else self.header_credits
            required_count = len(course_slots)

        placeholders = [s["placeholder"] for s in self.slots if "placeholder" in s]
        if placeholders:
            logic["placeholders"] = placeholders
            # A chooser's rows keep their hours too, in step with placeholders:
            # rows WITH hours that fill the header's credits are parts of it
            # ("Approved electives 12" + "Core elective 3-4" under "Electives:
            # 15-16"), rows without are alternatives (concentration names).
            if is_choose and any(s.get("credits") for s in self.slots if "placeholder" in s):
                logic["placeholder_credits"] = [s.get("credits") for s in self.slots if "placeholder" in s]

        return RequirementGroupRow(
            group_key=key,
            name=self.name,
            rtype=rtype,
            logic=logic,
            eligible_course_ids=flat,
            required_credits=required_credits,
            required_course_count=required_count,
            sort_order=self.sort_order,
            section=_classify_section(self.name),
            raw_html="\n".join(self.raw_rows),
        )


def _row_lookahead(trs: list[Tag]) -> tuple[list[bool], list[bool]]:
    """Two look-ahead facts per row, which the single-pass parse cannot see.

    hourless_next[i]: the next course row (past bare "OR" separators) carries
    no hours, so an instruction at row i lists hour-less options.

    shape_chooser[i]: row i is a code-less body row WITH hours followed by at
    least two hour-less course rows. Changed from UF Planner: that is how the
    catalog lays out a chooser even when its text gives no instruction
    ("Approved electives 6" over 5 courses on las_uct31, "Electives Outside of
    the Major 6" over 16 on aps_umn, "Select remaining coursework from these
    approved math/science electives: 3-4" on gly_bs03). Read as a placeholder,
    every option below it was required."""
    facts = []
    for tr in trs:
        classes = tr.get("class", [])
        tds = tr.find_all("td")
        if "hidden" in classes or not tds:
            facts.append(None)
            continue
        code_td = tr.find("td", class_="codecol")
        hours_td = tr.find("td", class_="hourscol")
        text = " ".join(tr.get_text(" ", strip=True).replace("\xa0", " ").split())
        facts.append({
            "header": "areaheader" in classes or "areasubheader" in classes or "listsum" in classes,
            "or": "orclass" in classes or text.upper() == "OR",
            "course": bool(code_td and COURSE_CODE_RE.search(code_td.get_text(" ", strip=True))),
            "hours": _cell_credits(hours_td.get_text(" ", strip=True)) if hours_td else None,
            "text": text,
        })
    n = len(trs)
    hourless_next = [False] * n
    shape_chooser = [False] * n
    for i, row in enumerate(facts):
        if row is None:
            continue
        options = 0
        for nxt in facts[i + 1:]:
            if nxt is None or nxt["or"]:
                continue
            if nxt["header"] or nxt["hours"] is not None:
                break
            if nxt["course"]:
                options += 1
            elif _parse_select(nxt["text"]) is not None or AT_MOST_RE.search(nxt["text"]):
                break  # "And, select one:" (gpy_ba02) opens the next chooser; a cap ends it
            # any other hour-less text row is an alternative ("One or more
            # 3000/4000-level ZOO course(s)" on zly_bs): the options go on past it
        hourless_next[i] = options > 0
        shape_chooser[i] = (options >= 2 and not row["header"] and not row["or"]
                            and not row["course"] and bool(row["hours"])
                            and not AT_MOST_RE.search(row["text"])
                            and not DISTRIBUTION_RE.search(row["text"])
                            and not SUBTOTAL_REF_RE.search(row["text"]))
    return hourless_next, shape_chooser


def parse_courselist(
    table: Tag,
    used_keys: set[str] | None = None,
    heading: str = "",
    intro: str = "",
    elective: bool = False,
) -> tuple[list[RequirementGroupRow], float | None]:
    """One sc_courselist table -> requirement groups + the page's stated total.

    used_keys must be shared across every table of one program page:
    (program_id, group_key) is the DB primary key, and multi-table pages can
    otherwise emit the same default "Requirements" key twice.

    heading/intro/elective carry the table's surrounding context (the <h2>/<h3>
    above it and its intro <p>). A headerless table takes its name — and any
    "| Select N" instruction — from the heading instead of the default
    "Requirements"; an `elective` table's plain option-lists are pooled into one
    chooser rather than emitted as separate required groups (see _pool_*)."""
    groups: list[RequirementGroupRow] = []
    if used_keys is None:
        used_keys = set()
    builder: _GroupBuilder | None = None
    # A headerless table whose heading carries an explicit "… | Select Two"
    # instruction takes that name and becomes a chooser. Without a Select-N in
    # the heading the default group stays "Requirements" (byte-identical to the
    # old behaviour) so ordinary single-table programs are untouched.
    heading_sel = _parse_select(heading, anchored=False) if heading else None
    heading_name = re.split(r"\s*[|:]\s*", heading, 1)[0].strip() if heading else ""
    parent_name = heading_name if heading_sel else "Requirements"
    total_credits: float | None = None
    sort_order = 0
    prev_or = row_or = False  # was the previous row a bare "OR" separator?
    # Did a subheader under the current areaheader label a chooser's
    # alternative? Then later subheaders are labels too, even past a chooser
    # nested inside one (apy_bs: "Physics" holds "Select one option:").
    labelled = False

    def finish() -> None:
        nonlocal builder
        if builder is not None:
            # A "Recommended Coursework" areaheader accumulated its rows only so
            # parsing could continue past them — it is not a requirement, so drop
            # it (see RECOMMENDED_RE).
            if builder.skip:
                if builder.slots:
                    log.info("dropping recommended (non-required) group %r", builder.name)
                builder = None
                return
            # Instruction-only builders ("Select from all sections:" ahead of
            # the first subheader) carry no requirement of their own.
            if builder.slots or builder.header_credits is not None:
                groups.append(builder.build(used_keys))
            builder = None

    trs = table.find_all("tr")
    hourless_next, shape_chooser = _row_lookahead(trs)
    for i, tr in enumerate(trs):
        classes = tr.get("class", [])
        if "hidden" in classes:
            continue
        tds = tr.find_all("td")
        if not tds:
            continue
        row_text = _cell_text(tr)
        prev_or, row_or = row_or, row_text.strip().upper() == "OR"
        hours_td = tr.find("td", class_="hourscol")
        hours = _cell_credits(_cell_text(hours_td)) if hours_td else None

        if "listsum" in classes:
            total_credits = hours
            continue

        if "areaheader" in classes or "areasubheader" in classes:
            name = _cell_text(tds[0])
            # Headers can embed the chooser instruction:
            # "Section 1: Experiential Learning; select 1 course  3".
            sel = _parse_select(name, anchored=False)
            # "Total ..." summary rows (marked areaheader by the catalog, not
            # listsum) restate a subtotal and carry no requirement of their own.
            # Capture the value as the table total and never emit a group.
            if sel is None and TOTAL_HEADER_RE.match(name):
                finish()
                if hours is not None:
                    total_credits = hours
                builder = None
                continue
            # A "Select N options" chooser lists its choices as follow-on
            # "* Option"/"Option *" sub-headers ("Logic Option", "Option A")
            # whose indented courses are the choices — absorb them into the
            # chooser instead of splitting off empty groups. A non-Option
            # header ("Remaining Credits") ends the collection normally.
            if (builder is not None and builder.collecting_options
                    and sel is None and OPTION_RE.search(name)):
                builder.raw_rows.append(str(tr))
                continue
            # Changed from UF Planner: a subheader carrying its own hours that
            # is not an "Option …" label is the NEXT requirement, not an
            # alternative ("Plant breeding - select one: 3" then "Electives 9"
            # on plb_umn; "Physics 8-10" after "Select one: 3" on bty_bs04;
            # "Capstone course 1" on gpy_ba03). UF Planner folded it into the
            # chooser as a placeholder, so its credits were never required.
            starts_requirement = bool(hours) and OPTION_RE.search(name) is None
            # Changed from UF Planner: so is an hour-less one once the chooser
            # already has its own course options and no subheader labels
            # ("Select two: 6-8" over four ecology courses, then "Cells and
            # Tissues" and its own "Select one: 3-4" on bot_bs01; "General
            # Geology BS Major Core Coursework: 18 credits" on gly_bs03). A
            # chooser whose options ARE subheaders labels them before any
            # course ("Select three of the following groups ...:" then
            # "Wildlife", "Tourism" on agl_uct20), so those stay alternatives.
            if (not starts_requirement and builder is not None and builder.is_choose
                    and OPTION_RE.search(name) is None and not labelled
                    and name.strip().upper() != "OR"
                    and any("ids" in s for s in builder.slots)):
                starts_requirement = True
            if ("areaheader" not in classes and sel is None and not starts_requirement
                    and builder is not None and builder.is_choose):
                # A plain subheader inside a chooser ("Option 1" / "Option 2"
                # under "Select one Calculus sequence:") labels an alternative
                # bundle — keep collecting options, keep the label visible.
                builder.raw_rows.append(str(tr))
                builder.add_placeholder(name, hours)
                # an "OR" printed as a subheader (bot_bs02, between Option A
                # and Option B) separates alternatives; it labels nothing
                labelled = labelled or name.strip().upper() != "OR"
                continue
            finish()
            labelled = False  # a new requirement: earlier labels were the last one's
            parent_name = name
            builder = _GroupBuilder(name, hours, sort_order)
            builder.skip = _recommended_only(name)
            if sel is not None:
                builder.is_choose = True
                builder.choose_n = sel["n"]
                if sel["credits"] is not None and builder.header_credits is None:
                    builder.header_credits = sel["credits"]
            builder.raw_rows.append(str(tr))
            sort_order += 1
            continue

        if builder is None:
            # Rows before any header (single-group tables) get a default group,
            # named from the table heading. A "… | Select Two" heading makes it a
            # chooser (the instruction lives in the heading, not a table row).
            builder = _GroupBuilder(parent_name, heading_sel["credits"] if heading_sel else None, sort_order)
            if heading_sel is not None:
                builder.is_choose = True
                builder.choose_n = heading_sel["n"]
            sort_order += 1

        code_td = tr.find("td", class_="codecol")
        ids = _codes_in_cell(code_td) if code_td else []
        # Changed from UF Planner: the plan grid's s93 rule applies to course
        # lists too. An UNLINKED code at a round thousand names a level, not a
        # course ("MUN 1000/3000 Music ensemble 1" on art_uct04, "DAA 2000-4000
        # Any level of any technique course" on art_uct03), so the row is a
        # placeholder rather than a course the catalog does not have.
        if (ids and code_td.find("a", class_="code") is None
                and all(re.fullmatch(r"[a-z]{3}\d000", c) for c in ids)):
            ids = []

        if "orclass" in classes:
            builder.raw_rows.append(str(tr))
            if ids:
                builder.extend_last_slot(ids)
            continue

        # A chooser's options are the blockindent rows under its "Select ..."
        # instruction; the first non-indented row resumes the surrounding
        # group ("STA 2023" after the indented calculus-sequence options).
        indented = tr.find("div", class_="blockindent") is not None
        # A collecting chooser absorbs "* Option" headers and their indented
        # courses; a non-indented *plain course* (not an option) means the
        # option list is over and a new required course has begun.
        if builder.collecting_options and not indented and ids:
            finish()
            builder = _GroupBuilder(parent_name, None, sort_order)
            sort_order += 1
        # A non-indented "Option B/C" label is NOT the end of the chooser — it
        # opens the next option bucket. Keep it in the same builder (build()
        # groups the buckets into logic.options); only a real non-option,
        # non-indented row ends the chooser's option list.
        is_option_label = (
            not ids and bool(row_text)
            and OPTION_RE.search(row_text) is not None
            and _parse_select(row_text) is None
        )
        select = None
        if not ids and row_text:
            select = _parse_select(row_text)
            if select is None and shape_chooser[i]:  # "Approved electives 6" over options
                select = {"n": None, "credits": hours}
        # A bare "OR" between indented options separates two alternatives
        # ("BOT 2010C & BOT 2011C / OR / BSC 2010 & 2010L, BSC 2011 & 2011L" on
        # bot_bs01): it does not end the chooser (build() splits on it). An
        # instruction row ends it below, named from its own text.
        if (builder.is_choose and builder.saw_indent and not indented
                and not builder.collecting_options and not is_option_label and not row_or
                and not (select is not None and builder.slots)):
            finish()
            builder = _GroupBuilder(parent_name, None, sort_order)
            sort_order += 1

        # Changed from UF Planner: a chooser whose options carry no hours ends
        # at the first row that has them ("Chinese Language (select one) 6-10"
        # then "CHI, CHT, or CHW courses ... 9" on eac_eaj_umn). Options that
        # carry hours keep later rows with hours as alternatives (com_umn's
        # "CJC study abroad course 3"), so this applies only to end_on_hours.
        if (builder.end_on_hours and hours is not None and select is None and not indented
                and any("ids" in s for s in builder.slots)):
            finish()
            builder = _GroupBuilder(parent_name, None, sort_order)
            sort_order += 1

        if not ids and row_text:
            # A chooser collecting "* Option" buckets keeps a nested "Select …"
            # inside an option, but a second "Select one … option:" row is the
            # NEXT chooser (s93): Entomology BS07 prints "Select one Mathematics
            # option:" then "Select one Physics option:", and the physics
            # choice was folded into mathematics, so no board planned physics.
            # An "OR" row between them keeps them ONE choice: Classics prints
            # "Select one beginning Latin option: … OR … Select one beginning
            # ancient Greek option:", four routes of which a student takes one.
            if (select is not None and builder.slots
                    and (not builder.collecting_options
                         or (OPTION_RE.search(row_text) and not prev_or))):
                # "Select ..." mid-group: split its options into their own
                # chooser group instead of flattening the whole group.
                finish()
                header = select["credits"] if select["credits"] is not None else hours
                builder = _GroupBuilder(_cell_text(tds[0]).rstrip(":").strip() or parent_name,
                                        header, sort_order)
                builder.is_choose = True
                builder.choose_n = select["n"]
                builder.end_on_hours = hourless_next[i]
                # "Select one option ..." (at the row's start; see add_placeholder)
                if OPTION_RE.search(row_text) and re.match(r"(?i)\s*(?:select|choose)\b", row_text):
                    builder.collecting_options = True
                builder.raw_rows.append(str(tr))
                sort_order += 1
                continue

        if not ids and row_text and SUBTOTAL_REF_RE.search(row_text):
            # "(from the table above)" restates a subtotal of courses already
            # counted; skip it so its credits don't double-count the table.
            continue

        builder.raw_rows.append(str(tr))
        if indented:
            builder.saw_indent = True

        if ids:
            # "PHY 2048 & 2048L" requires BOTH courses — one slot each (the
            # row's hours go on the first; labs are bundled into them).
            # A slot's ids are alternatives, which only "A or B" rows are.
            if len(ids) > 1 and "&" in _cell_text(code_td):
                builder.add_course_slot([ids[0]], hours)
                for cont in ids[1:]:
                    builder.add_course_slot([cont], None)
            else:
                builder.add_course_slot(ids, hours)
        elif row_text:
            builder.add_placeholder(row_text, hours, select)
            if select is not None:
                builder.end_on_hours = hourless_next[i]

    finish()
    groups = _fold_credit_header_options(groups, used_keys)
    if elective:
        groups = _pool_elective_options(groups, heading, intro, used_keys)
    return groups, total_credits


_OPTION_SUBLIST_RE = re.compile(r"^\s*(group|category|list)\s+[A-Za-z0-9]", re.IGNORECASE)


def _plain_option_group(g: RequirementGroupRow) -> bool:
    """A group that is a bare list of option courses — a required_list of courses
    with no requirement instruction of its OWN (no 'Select …' and no stated
    "N credits" in its name). Its required_credits, if any, is just the sum of
    its course hours, NOT a stated requirement, so it is ignored here. These are
    the sub-lists that a 'Select N from the following' parent or an elective
    heading turns into pooled options (aro's departments, sst's themes)."""
    return (
        g.rtype == "required_list"
        and bool(g.eligible_course_ids)
        and g.section == "major"
        and not _CREDITS_IN_NAME_RE.search(g.name)
        and not re.match(r"(?i)\s*select\b", g.name)
    )


def _pooled_group(
    key: str, name: str, courses: list[str], credits: float | None,
    n: int | None, sort_order: int, section: str, used_keys: set[str],
) -> RequirementGroupRow:
    while key in used_keys:
        m = re.match(r"(.*?)(?:-(\d+))?$", key)
        key = f"{m.group(1)}-{int(m.group(2) or 1) + 1}"
    used_keys.add(key)
    if credits is not None:
        logic: dict = {"from": courses, "credits": credits}
    elif n is not None:
        logic = {"from": courses, "n": n}
    else:
        logic = {"from": courses, "credits": None, "open_electives": True}
    return RequirementGroupRow(
        group_key=key, name=name,
        rtype="choose_credits" if n is None else "choose_n",
        logic=logic, eligible_course_ids=courses,
        required_credits=credits, required_course_count=n,
        sort_order=sort_order, section=section, raw_html="",
    )


def _fold_credit_header_options(
    groups: list[RequirementGroupRow], used_keys: set[str]
) -> list[RequirementGroupRow]:
    """"Foundation Coursework: 9 credits" (a credit-in-name header with NO
    course list of its own — its courses live in the following "Group A" /
    "Group B" sub-lists) means those sub-lists are its OPTIONS. Fold them into
    one choose_credits(N) pool. Tightly gated: the header must carry its own
    credits AND be followed by groups explicitly NAMED as option sub-lists
    ("Group A", "Category B"), so a following required course group (a Capstone,
    a "Related Coursework" requirement) is never absorbed."""
    out: list[RequirementGroupRow] = []
    i = 0
    while i < len(groups):
        g = groups[i]
        m = _CREDITS_IN_NAME_RE.search(g.name)
        empty_credit_header = (
            m is not None and not g.eligible_course_ids and g.section == "major"
            and g.rtype == "required_list"
        )
        if empty_credit_header:
            pool: list[str] = []
            j = i + 1
            while (j < len(groups) and _plain_option_group(groups[j])
                   and _OPTION_SUBLIST_RE.match(groups[j].name)):
                pool.extend(c for c in groups[j].eligible_course_ids if c not in pool)
                j += 1
            if pool:
                out.append(_pooled_group(
                    g.group_key, g.name, pool, float(m.group(1)), None,
                    g.sort_order, g.section, used_keys))
                i = j
                continue
        out.append(g)
        i += 1
    return out


def _pool_elective_options(
    groups: list[RequirementGroupRow], heading: str, intro: str, used_keys: set[str]
) -> list[RequirementGroupRow]:
    """A table the heading/intro marks as an elective POOL ("Technical
    Electives", "may take any three courses … do not indicate required
    distributions"): its plain option-lists (department / theme sub-lists with
    no per-area credit) are NOT separate requirements — pool them into one
    chooser. Credit-bearing or "Select N" sub-areas (a real distribution
    requirement, e.g. EVS's "Physical Sciences: select 3-15") are left intact."""
    plains = [g for g in groups if _plain_option_group(g)]
    if len(plains) == 1 and len(groups) == 1:
        # The whole table is ONE bare list under an elective heading (Statistics
        # minor: "Approved Electives" lists 15 courses, the Overview row above
        # reserves 6 credits of them). Changed from UF Planner, which parsed it
        # as 15 required courses: it is an option pool for link_option_pools.
        g = plains[0]
        g.rtype, g.section, g.required_credits, g.required_course_count = "choose_credits", "options", None, None
        g.logic = {"from": g.eligible_course_ids, "credits": None, "option_pool": True,
                   "heading": heading}
        g.name = re.split(r"\s*[|:]\s*", heading, 1)[0].strip() or g.name
        g.group_key = f"options-{_slugify(g.name)}"
        while g.group_key in used_keys:
            m = re.match(r"(.*?)(?:-(\d+))?$", g.group_key)
            g.group_key = f"{m.group(1)}-{int(m.group(2) or 1) + 1}"
        used_keys.add(g.group_key)
        return groups
    if len(plains) < 2:
        return groups  # nothing to pool (real per-area choosers stay as-is)
    pool: list[str] = []
    for g in plains:
        pool.extend(c for c in g.eligible_course_ids if c not in pool)
    # Credit / count from the intro or heading: "may take any three courses" -> 3
    # courses; "Select 9 credits" -> 9 cr; else an open elective slot.
    n = cred = None
    sel = _parse_select(intro, anchored=False) or _parse_select(heading, anchored=False)
    m_courses = re.search(r"any\s+(\w+)\s+courses?", intro, re.IGNORECASE)
    if sel and sel.get("credits") is not None:
        cred = sel["credits"]
    elif sel and sel.get("n") is not None:
        n = sel["n"]
    elif m_courses:
        n = WORD_NUMBERS.get(m_courses.group(1).lower()) or (
            int(m_courses.group(1)) if m_courses.group(1).isdigit() else None)
    first = plains[0]
    pooled = _pooled_group(
        _slugify(heading_name := re.split(r"\s*[|:]\s*", heading, 1)[0].strip() or first.name),
        heading_name, pool, cred, n, first.sort_order, first.section, used_keys)
    kept = [g for g in groups if g not in plains]
    return kept + [pooled]


def _is_blockindent(el: object) -> bool:
    return isinstance(el, Tag) and "blockindent" in (el.get("class") or [])


def _indented_cell(td: Tag) -> bool:
    """An OPTION row: the whole cell sits inside a leading blockindent div,
    which is how the grid prints the rows under a "Select one:" header."""
    first = next((x for x in td.children if isinstance(x, Tag) or str(x).strip()), None)
    return _is_blockindent(first) and first.name == "div"


def _cell_arms(td: Tag) -> list[list[str]]:
    """A codecol cell's course ids, split at its "or"s (s94).

    "CGN 2328 <div class=blockindent>or EML 2023</div>" is two arms, [[cgn2328],
    [eml2023]]; "CHM 2045 <span class=blockindent>& 2045L</span>" is one arm of
    two courses. Only a blockindent that STARTS with "or" splits: an "or" in
    prose ("ANT 2000 or SYG 2000 recommended") is a placeholder's text."""
    has_or = any(
        b.get_text(" ", strip=True).lower().startswith("or ")
        for b in td.find_all(class_="blockindent")
    )
    text = _cell_text(td)
    pieces = re.split(r"\s+or\s+", text, flags=re.IGNORECASE) if has_or else [text]
    return [a for a in (_codes_in_text(p) for p in pieces) if a]


def parse_plangrid(table: Tag) -> list[PlanRow]:
    """One sc_plangrid table -> model-plan rows. Alternatives after the first
    carry no credits, so semester sums stay honest.

    Since s94 each row also says which CHOICE it belongs to (`alt_group`,
    `alt_option`; see PlanRow). The grid prints a choice three ways:
      * "A or B" inside one cell (a blockindent starting "or");
      * a text header ("Select one:", "Select one Ecology course:") followed by
        indented option rows, each one option, "A & AL" rows included;
      * a row starting "Or …" (Theatre BFA02, Music Business), an alternative
        to the row above it.
    An indented row with no header above it (Mechanical Engineering's EML 4914)
    joins nothing: which rows it is an alternative to is not printed."""
    plan: list[PlanRow] = []
    semester = 0
    position = 0
    is_summer = False
    n_alt = 0
    open_alt: int | None = None   # the choice an indented run is filling
    next_option = 1
    prev: list[PlanRow] = []      # the previous tr's rows, in this term
    prev_header = False           # was the previous tr a lone text row?

    for tr in table.find_all("tr"):
        classes = tr.get("class", [])
        if "plangridterm" in classes:
            semester += 1
            position = 0
            is_summer = "summer" in _cell_text(tr).lower()
            open_alt, prev, prev_header = None, [], False
            continue
        if "plangridsum" in classes or "plangridtotal" in classes or "hidden" in classes:
            continue
        code_td = tr.find("td", class_="codecol")
        if code_td is None:
            continue
        hours_td = tr.find("td", class_="hourscol")
        credits = _cell_credits(_cell_text(hours_td)) if hours_td else None
        critical = "critical tracking" in _cell_text(tr).lower()

        indented = _indented_cell(code_td)
        linked = code_td.find("a", class_="code") is not None
        arms = _cell_arms(code_td)
        text = _cell_text(code_td)
        # "Select one GEO/GIS 4000 level technique course:" names a level, not
        # a course; with no link in the cell it is a header, not GIS 4000.
        if arms and not linked and not indented and re.match(r"select\b", text, re.I):
            arms = []
        # "MUN 1000 or MUN 2000", "GLY 3000+", "MUH 3000 or 4000 level": an
        # UNLINKED code at a round thousand names a LEVEL, not a course — s93's
        # rule for tracking rows. The row is a placeholder, so a spine reserves
        # its credits instead of asking for a course the catalog does not have.
        if arms and not linked and all(re.fullmatch(r"[a-z]{3}\d000", c) for a in arms for c in a):
            arms = []
        starts_or = re.match(r"or\b", text, re.IGNORECASE) is not None

        # Which choice this row joins, and as which option.
        alt: int | None = None
        if starts_or and prev:
            if prev[0].alt_group is None:
                n_alt += 1
                for r in prev:
                    r.alt_group, r.alt_option = n_alt, 1
            alt = prev[0].alt_group
            next_option = max(r.alt_option or 0 for r in plan if r.alt_group == alt) + 1
        elif indented:
            if open_alt is None and prev_header and prev:
                n_alt += 1
                prev[0].alt_group, prev[0].alt_option = n_alt, 0
                open_alt, next_option = n_alt, 1
            alt = open_alt
        else:
            open_alt = None
        if alt is None and len(arms) > 1:
            n_alt += 1
            alt, next_option = n_alt, 1

        rows: list[PlanRow] = []
        if not arms:
            if text:
                rows.append(PlanRow(semester, position, None, text, credits, critical, is_summer))
                position += 1
        else:
            first = True
            for arm in arms:
                for cid in arm:
                    rows.append(PlanRow(semester, position, cid, None,
                                        credits if first else None, critical, is_summer))
                    first = False
                    position += 1
                if alt is not None:
                    for r in rows:
                        if r.alt_group is None:
                            r.alt_group, r.alt_option = alt, next_option
                    next_option += 1
        if alt is not None and not arms:
            for r in rows:
                r.alt_group, r.alt_option = alt, next_option
            next_option += 1
        plan.extend(rows)
        prev = rows
        prev_header = bool(rows) and not arms and not indented and alt is None

    return plan


# What a program page's H1 puts after the pipe, when it is NOT part of the
# program's name. Three kinds, all of which the record already carries in their
# own columns: the college (whole name or abbreviation), the degree, and the
# interdisciplinary-studies tag. Everything else after a pipe is a
# SPECIALIZATION and belongs in the name — "Journalism | Sports and Media",
# "Advertising | Persuasive Messaging".
_TITLE_DROP_RE = re.compile(
    r"""^(?:
        (?:.*\bcollege\b.*) |           # "Herbert Wertheim College of Engineering"
        (?:school\s+of\b.*) |
        C[A-Z]{2,4} |                   # CLAS, CALS, CJC, …
        IDS |
        B[A-Z]{1,4} |                   # BS, BA, BFA, BSBA, BSAD, BAE, …
        (?:bachelor\s+of\b.*) |
        (?:master\s+of\b.*)
    )$""",
    re.IGNORECASE | re.VERBOSE,
)


def _program_name(page_name: str, degree: str | None) -> str:
    """The program's name from its H1, KEEPING a specialization.

    UF prints a specialized program as "Parent | Specialization" and everything
    after the pipe used to be discarded, which is how UF Online's Advertising
    degree came to be called plain "Advertising" — a name UF does not offer, and
    one that hid which of the two specializations the online route actually is
    (Persuasive Messaging; Advertising Agency has no online version).

    The pipe is overloaded, though: the same slot also carries the college
    ("Computer Science | Herbert Wertheim College of Engineering"), the degree
    ("Dance | Bachelor of Fine Arts", "Art | BFA") and the interdisciplinary tag
    ("Medieval and Early Modern Studies | IDS"). All three are already columns of
    their own on the record, so they are dropped and anything else is kept. Where
    a title carries several ("Business Administration | General Studies | BABA"),
    each part is judged on its own.
    """
    parts = [p.strip() for p in page_name.split("|") if p.strip()]
    if not parts:
        return ""
    keep = [parts[0]]
    for part in parts[1:]:
        if _TITLE_DROP_RE.match(part):
            continue
        if degree and part.upper() == degree.upper():
            continue
        keep.append(part)
    return " — ".join(keep)


def program_identity(url: str, page_name: str) -> ProgramRecord:
    """Derive id/college/degree from the program URL and the page H1."""
    m = PROGRAM_URL_RE.search(url)
    college, code = (m.group(1), m.group(2)) if m else (None, url.rstrip("/").rsplit("/", 1)[-1])
    program_id = f"{college.lower()}-{code.lower()}" if college else code.lower()
    # CPS_BSCS -> degree BSCS; minor/certificate pages have no degree suffix.
    # A trailing _UFO marks the UF Online delivery of the same program
    # (FYC_UMN_UFO is still a minor), so classify on the code before it.
    # Trailing digits number a variant/track (AGL_UCT06 is a certificate,
    # ANS_BS01 a BS track) — classify on the letters.
    degree = None
    kind = "major"
    base = code[:-4] if code.lower().endswith("_ufo") else code
    if "_" in base:
        suffix = base.rsplit("_", 1)[1].upper()
        stem = re.sub(r"\d+$", "", suffix) or suffix
        if stem in {"UMN", "MIN"} or "minor" in page_name.lower():
            kind = "minor"
        elif stem in {"CRT", "UCT"} or "certificate" in page_name.lower():
            kind = "certificate"
        else:
            degree = stem
    name = _program_name(page_name, degree) or code
    return ProgramRecord(
        id=program_id, name=name, kind=kind, degree=degree, college_slug=college, url=url
    )


def _placeholder_slot(text: str, credits: float | None, semester: int) -> dict:
    """A spine row no course names ("Upper Division Elective", "MUN Ensemble").
    Since s94 it carries the credits the grid prints beside it and the grid
    column it sits in, so the engine can RESERVE it where UF puts it; before,
    a placeholder slot queued nothing and every grid-derived board came up
    short by exactly these rows."""
    slot: dict = {"placeholder": text}
    # A bare "Elective" row is a FREE elective: the degree's slack up to 120,
    # which the engine already states as a credit shortfall. Reserving it as
    # well double-booked the space, so six boards could no longer fit their
    # required courses in eight 16-credit terms (s94). A row that NAMES what
    # it is ("Upper Division Elective", "Elective (3000/4000 level)", "MUN
    # Ensemble") is a requirement and is reserved.
    if credits and not _FREE_ELECTIVE_RE.fullmatch(text.strip()):
        slot["credits"] = credits
        slot["semester"] = semester
    return slot


_FREE_ELECTIVE_RE = re.compile(
    r"(?:free\s+|general\s+)?electives?(?:\s*\(\s*writing requirement[^)]*\)?)?", re.IGNORECASE
)


_SELECT_CREDITS_RE = re.compile(r"select\s+(\d+)(?:\s*-\s*\d+)?\s+credits?", re.IGNORECASE)


def _plan_choice_groups(plan: list[PlanRow]) -> tuple[dict[int, list], list[RequirementGroupRow]]:
    """The grid's CHOICES (s94), for `derive_group_from_plan`.

    Returns ({alt_group: spine slot or None}, [extra groups]). A choice between
    single courses, one to pick, is ONE spine slot whose arms are the options
    ("CGN 2328 or EML 2023"). What a slot cannot say becomes its own group:
    options that are bundles ("COP 2271 & 2271L" | "COP 2273") are an options
    group, "Select two:" a count, "Select 9-11 credits:" a credit pool. A
    choice with an option no course names ("THE 2001" | "Or State Core Gen Ed
    Humanities") is open, so it reserves a placeholder slot. A gen-ed header's
    OWN choice is still kept: "Gen Ed Biological Sciences … Critical Tracking
    (select one:)" names the chemistry routes the major tracks."""
    by_alt: dict[int, list[PlanRow]] = {}
    for row in plan:
        if row.alt_group is not None:
            by_alt.setdefault(row.alt_group, []).append(row)
    spine: dict[int, list] = {}
    extra: list[RequirementGroupRow] = []
    for alt, rows in by_alt.items():
        header = next((r for r in rows if r.alt_option == 0), None)
        options: dict[int, list[PlanRow]] = {}
        for r in rows:
            if r.alt_option:
                options.setdefault(r.alt_option, []).append(r)
        opts = [[r.course_id for r in o if r.course_id] for o in options.values()]
        texts = [r.placeholder for o in options.values() for r in o if r.placeholder]
        credits = (header.credits if header else rows[0].credits) or None
        head = (header.placeholder if header else "") or ""
        if not opts or any(not o for o in opts):
            code = lambda c: f"{c[:3].upper()} {c[3:].upper()}"  # noqa: E731
            label = head or " or ".join(
                [" & ".join(code(c) for c in o) for o in opts if o]
                + [re.sub(r"^or\s+", "", t, flags=re.IGNORECASE) for t in texts])
            area, quest = _gened_area(head) if head else (None, None)
            if quest is not None or area in _GENED_COVERED_BY_GROUP:
                spine[alt] = None   # the gen-ed group already asks for it
            else:
                spine[alt] = _placeholder_slot(label, credits, rows[0].semester_index)
            continue
        sel = _parse_select(head, anchored=False) if head else None
        m_cr = _SELECT_CREDITS_RE.search(head)
        n = (sel or {}).get("n") or 1
        ids = list(dict.fromkeys(i for o in opts for i in o))
        key = f"plan-derived-choice-{alt}"
        name = re.sub(r"\s*[:;,]\s*$", "", head).strip() or "Choose one"
        sem = rows[0].semester_index
        if m_cr:
            extra.append(RequirementGroupRow(
                key, name, "choose_credits",
                {"from": ids, "credits": float(m_cr.group(1)), "derived_from": "plangrid",
                 "model_semester": sem},
                ids, float(m_cr.group(1)), None, 0, "major", ""))
        elif n > 1:
            extra.append(RequirementGroupRow(
                key, name, "choose_n",
                {"from": ids, "n": n, "derived_from": "plangrid", "model_semester": sem},
                ids, credits, n, 0, "major", ""))
        elif all(len(o) == 1 for o in opts):
            spine[alt] = [o[0] for o in opts]
        else:
            extra.append(RequirementGroupRow(
                key, name, "choose_credits",
                # Changed from UF Planner: the logic carries its own n / credits like
                # every other chooser, not only the CSV columns.
                {"options": opts, "credits": credits, "derived_from": "plangrid", "model_semester": sem},
                ids, credits, None, 0, "major", ""))
    return spine, extra


def derive_group_from_plan(plan: list[PlanRow]) -> list[RequirementGroupRow]:
    """Fallback for pages with a model plan but no sc_courselist (e.g. UGENG
    BME_BSBM/ICE_BSICE): synthesize the requirements from the plan so the
    program yields reviewable data instead of nothing. QA recognizes
    logic.derived_from and caps confidence below the publish gate; these
    programs can only go live via a per-program override.

    Until s94 every arm of a grid choice ("A or B", the rows under "Select
    one:") landed as its own REQUIRED slot, beside a blank for the "Select
    one:" header itself, so a spine asked for both studios of Landscape
    Architecture's "Select one studio" and Biological Engineering's credits ran
    out before its capstones. Now a choice is one slot, or its own group
    (`_plan_choice_groups`), and the spine is the rows that are not a choice.
    """
    choice_slots, choice_groups = _plan_choice_groups(plan)
    done: set[int] = set()
    slots: list = []
    flat: list[str] = []
    placeholders: list[str] = []
    credits = 0.0
    n_courses = 0
    for row in plan:
        if row.alt_group is not None:
            if row.alt_group in done:
                continue
            done.add(row.alt_group)
            slot = choice_slots.get(row.alt_group)
            if slot is None:
                continue   # its own group, or a gen-ed group's
            header = next((r for r in plan if r.alt_group == row.alt_group
                           and r.alt_option == 0), None)
            slots.append(slot)
            if isinstance(slot, dict):
                placeholders.append(slot["placeholder"])
            else:
                flat.extend(c for c in slot if c not in flat)
                n_courses += 1
            c = (header.credits if header else row.credits)
            if c is not None:
                credits += c
            continue
        # Gen-ed placeholder rows are emitted as their own groups by
        # derive_gened_groups(); carrying them here too double-counted gen-ed
        # (~25-36 cr) and made plan-derived majors infeasible. Skip exactly the
        # areas that get a standalone group (International/Diversity get none, so
        # those rows stay here as honest reserved credits).
        if row.placeholder:
            area, quest = _gened_area(row.placeholder)
            if quest is not None or area in _GENED_COVERED_BY_GROUP:
                continue
        if row.course_id is not None:
            slots.append([row.course_id])
            if row.course_id not in flat:
                flat.append(row.course_id)
                n_courses += 1   # a course the grid repeats (an ensemble) once
        elif row.placeholder:
            slots.append(_placeholder_slot(row.placeholder, row.credits, row.semester_index))
            placeholders.append(row.placeholder)
        if row.credits is not None:
            credits += row.credits

    # "MUH 3211 or MUH 3212" in semester 4 and "MUH 3211" alone in semester 5
    # (Music Education) means the OTHER one: the grid requires MUH 3211 by
    # itself, so it cannot also answer the choice, and tracking names MUH 3212.
    # An arm the spine requires on its own row leaves every choice slot, unless
    # it is the slot's last arm.
    # The same choice printed as often as it has arms is every arm, one per
    # printing: Music Theory's "MUT 3611 or MUT 4401" in semesters 5 and 7 is
    # Form and Analysis 1 AND Counterpoint 1, and Landscape Architecture's
    # "LAA 3950 or LAA 3233" twice is Experience 2 AND Experience 3. The
    # engine lets one course fill every slot it appears in, so the second
    # printing asked for nothing.
    times: dict[tuple, int] = {}
    for s in slots:
        if isinstance(s, list) and len(s) > 1:
            times[tuple(s)] = times.get(tuple(s), 0) + 1
    split: set[tuple] = {k for k, n in times.items() if n >= len(k)}
    if split:
        seen_k: dict[tuple, int] = {}
        out: list = []
        for s in slots:
            k = tuple(s) if isinstance(s, list) else None
            if k in split:
                i = seen_k.get(k, 0)
                seen_k[k] = i + 1
                out.append([k[i]] if i < len(k) else list(k))
                continue
            out.append(s)
        slots = out
    alone = {s[0] for s in slots if isinstance(s, list) and len(s) == 1}
    slots = [
        [c for c in s if c not in alone] or s if isinstance(s, list) and len(s) > 1 else s
        for s in slots
    ]
    flat = [c for c in flat if any(isinstance(s, list) and c in s for s in slots)]
    logic: dict = {"slots": slots, "derived_from": "plangrid"}
    if placeholders:
        logic["placeholders"] = placeholders
    # A choice's slot has several arms, so it counts ONCE, not once per arm.
    return [RequirementGroupRow(
        group_key="plan-derived",
        name="Requirements (derived from model plan)",
        rtype="required_list",
        logic=logic,
        eligible_course_ids=flat,
        required_credits=credits or None,
        required_course_count=n_courses,
        sort_order=0,
        section="major",
        raw_html="",
    ), *choice_groups]


# Plan-grid gen-ed placeholder text -> gen-ed area code. "Biological or
# Physical Sciences" is a single either/or slot (its options are both lists).
def _gened_area(placeholder: str) -> tuple[str | None, str | None]:
    """(area_code, quest_code) for a gen-ed plan placeholder; (None, None) if
    the row is not gen-ed."""
    low = placeholder.lower()
    quest = "quest1" if "quest 1" in low else "quest2" if "quest 2" in low else None
    # NB: a bare "Writing Requirement" row is NOT Composition. Florida's
    # 24,000-word rule is satisfied by writing-designated courses in any area —
    # the engine already spends the plan's existing gen-ed/Quest slots on it
    # (see spendWritingSlots) — so counting those rows as Composition credit
    # double-counted them. Health Science Preprofessional lists two real
    # Composition rows and two "6000-word writing course (Writing Requirement)"
    # rows, and came out demanding 12 credits of Composition where UF's audit
    # asks 6. Only a row that actually names Composition counts as Composition.
    if "compos" in low:
        area = "composition"
    elif "humanities" in low:
        area = "humanities"
    elif "social" in low or "behavioral" in low:
        area = "social"
    elif "biological or physical" in low or "physical or biological" in low:
        area = "bio_or_phys"
    elif "biological" in low:
        area = "biological"
    elif "physical" in low:
        area = "physical"
    elif "mathematics" in low:
        area = "mathematics"
    elif "international" in low:
        area = "international"
    elif "diversity" in low:
        area = "diversity"
    else:
        area = None
    return area, quest


# Raw _gened_area() codes that derive_gened_groups() emits as a standalone group
# (bio_or_phys/biological/physical all fold into one Natural Sciences group).
# International/Diversity are deliberately excluded -- they get no standalone
# group, so their plan rows must stay in the plan-derived group.
_GENED_COVERED_BY_GROUP = {
    "composition", "humanities", "social", "mathematics",
    "bio_or_phys", "biological", "physical",
}


_GENED_AREA_NAMES = {
    "composition": "Composition (Gen Ed C)",
    "humanities": "Humanities (Gen Ed H)",
    "social": "Social & Behavioral Sciences (Gen Ed S)",
    "biological": "Biological Sciences (Gen Ed B)",
    "physical": "Physical Sciences (Gen Ed P)",
    "bio_or_phys": "Biological or Physical Sciences (Gen Ed B/P)",
    "natural_science": "Natural Sciences (Gen Ed B/P)",
    "mathematics": "Mathematics (Gen Ed M)",
    "international": "International (Gen Ed N)",
    "diversity": "Diversity (Gen Ed D)",
}


def derive_gened_groups(
    plan: list[PlanRow], area_courses: dict[str, list[str]], start_sort: int
) -> list[RequirementGroupRow]:
    """Synthesize gen-ed requirement groups for one program from its model-plan
    gen-ed placeholders (authoritative per-program credits) + the catalog's
    per-area approved-course lists. Quest 1/2 become their own groups, flagged
    waivable (AA degree or 60+ credits). State/UF areas are choose_credits over
    the area's approved courses."""
    area_credits: dict[str, float] = {}
    quest_credits: dict[str, float] = {}
    for row in plan:
        if not row.placeholder:
            continue
        area, quest = _gened_area(row.placeholder)
        if area is None and quest is None:
            continue
        credits = row.credits or 0.0
        if quest:
            quest_credits[quest] = quest_credits.get(quest, 0.0) + credits
        elif area:
            area_credits[area] = area_credits.get(area, 0.0) + credits

    # Normalize the sciences: model plans list natural science both generically
    # ("Biological or Physical Sciences") and specifically ("Biological",
    # "Physical"), which are the same requirement re-expressed, not additive.
    # Collapse to one Natural Sciences group taking the larger expression so we
    # neither triple-list nor inflate credits. Drop International/Diversity as
    # standalone groups — they are overlays satisfied within the other areas.
    bio_phys = max(
        area_credits.pop("bio_or_phys", 0.0),
        area_credits.pop("biological", 0.0) + area_credits.pop("physical", 0.0),
    )
    area_credits.pop("international", None)
    area_credits.pop("diversity", None)
    if bio_phys:
        area_credits["natural_science"] = bio_phys

    groups: list[RequirementGroupRow] = []
    sort_order = start_sort

    def options_for(area: str) -> list[str]:
        if area == "natural_science":
            merged = area_courses.get("biological", []) + area_courses.get("physical", [])
            return list(dict.fromkeys(merged))
        return list(area_courses.get(area, []))

    # Stable, conventional gen-ed ordering.
    order = ["composition", "humanities", "mathematics", "natural_science", "social"]
    for area in sorted(area_credits, key=lambda a: order.index(a) if a in order else 99):
        credits = area_credits[area]
        opts = options_for(area)
        groups.append(RequirementGroupRow(
            group_key=f"gened-{area}",
            name=_GENED_AREA_NAMES.get(area, area.title()),
            rtype="choose_credits",
            # An AA from a Florida public college (or an AA certificate from a
            # Florida public state university) exempts the student from UF's
            # General Education requirement OUTRIGHT — not merely from Quest.
            # Stamping only the Quest rows below, as this used to, left an AA
            # transfer still being scheduled all five state-core areas.
            # catalog.ufl.edu/UGRD/academic-programs/general-education/: "All
            # undergraduate students, except those transferring to UF with an AA
            # degree from a Florida public college or an AA certificate from a
            # Florida public state university, are required to complete UF's
            # General Education requirement to graduate."
            logic={"from": opts, "credits": credits or None, "gened_area": area,
                   "waived_by": "aa_or_60_credits"},
            eligible_course_ids=opts,
            required_credits=credits or None,
            required_course_count=None,
            sort_order=sort_order,
            section="geneed",
            raw_html="",
        ))
        sort_order += 1

    for quest, credits in sorted(quest_credits.items()):
        opts = list(area_courses.get(quest, []))
        groups.append(RequirementGroupRow(
            group_key=f"gened-{quest}",
            name=f"Quest {quest[-1]}",
            rtype="choose_credits",
            logic={"from": opts, "credits": credits or None, "gened_area": quest,
                   "waived_by": "aa_or_60_credits"},
            eligible_course_ids=opts,
            required_credits=credits or None,
            required_course_count=None,
            sort_order=sort_order,
            section="geneed",
            raw_html="",
        ))
        sort_order += 1

    return groups


# -- subject/level elective wildcards ----------------------------------------
#
# Liberal-arts major tables state their elective requirement as a rule rather
# than a list: "3000-level or higher Political Science courses  18". That row
# is fully specified (subject + minimum level + credits) — it just isn't
# enumerated on the page. Expanding it against the catalog turns a dead
# placeholder into a real approved-course pool, which is what lets the planner
# actually schedule those 18 credits instead of parking them in blank slots.
#
# Subject -> UF course prefixes. UF splits one department across several SCNS
# prefixes (Political Science is POS/CPO/INR/POT/PUP), so the mapping is
# explicit. Every prefix here was verified to exist in courses.csv.
SUBJECT_PREFIXES: dict[str, tuple[str, ...]] = {
    "political science": ("pos", "cpo", "inr", "pot", "pup"),
    "sociology": ("sya", "syd", "syg", "syo", "syp"),
    "religion": ("rel",),
    "geology": ("gly",),
    "anthropology": ("ant",),
    "women's studies": ("wst",),
    "african studies": ("afs", "afh", "afa", "swa"),
    "arabic": ("ara", "abt"),
    "chinese": ("chi", "cht", "chw"),
    "japanese": ("jpn", "jpt"),
    "history": ("amh", "euh", "woh", "ash", "lah", "afh", "his"),
    "english": ("eng", "enl", "aml", "lit", "crw"),
    # Added for level-range rows (changed from UF Planner); every prefix was
    # checked present in data/catalog/courses.csv on 2026-10-12.
    "psychology": ("psy", "psb", "exp", "dep", "clp", "sop", "ppe"),
    "spanish": ("spn", "spw"),
    "portuguese": ("por", "pow", "prt"),
    "marketing": ("mar",),
    "digital arts & sciences": ("dig",),
    "greek": ("gre", "grw"),
    "latin": ("lat", "lnw"),
    "classics": ("cla", "clt"),
}

# Two row phrasings, both seen on UF pages:
#   "3000-level or higher Political Science courses  18"   (level first)
#   "Sociology courses (3000 level or above)  9"           (subject first)
#   "Additional Geology courses at the 3000 level or higher  17"
_WILDCARD_LEVEL_FIRST = re.compile(
    r"^(?:\d000/)?(?P<level>\d)000[-\s]level or (?:higher|above)\s+"
    r"(?P<subject>.+?)\s+courses?\b\s*(?P<credits>\d+(?:\.\d+)?)?\s*$",
    re.IGNORECASE,
)
_WILDCARD_SUBJECT_FIRST = re.compile(
    r"^(?:additional\s+|advanced\s+)?(?P<subject>.+?)\s+(?:language\s+)?courses?\s*"
    r"(?:\(|at the\s+)?(?P<level>\d)000[-\s]level or (?:higher|above)\)?"
    r"\s*(?P<credits>\d+(?:\.\d+)?)?\s*$",
    re.IGNORECASE,
)


# Level-RANGE rows (changed from UF Planner, which only read "N000-level or
# higher"); the range's top bounds the pool:
#   "3000/4000-level History courses  12"      "1000 to 4000-level History courses  9"
#   "GLY courses (3000/4000 level)  6"         "3000 or 4000-level Spanish courses  9"
#   "ITA or ITW courses (3000/4000 level)  9"  "University Writing ... (2000-3000 level)"
#   "4000-level Spanish courses  12"           (one level: exactly that level)
_RANGE = r"(?P<lo>\d)000(?:\s*(?:/|to|or|-)\s*(?P<hi>\d)000)?[-\s]level"
_RANGE_LEVEL_FIRST = re.compile(
    rf"^(?:additional\s+|any\s+)?{_RANGE}\s+(?P<subject>.+?)\s+(?:(?:elective\s+)?courses?|electives?)\b\s*"
    r"(?P<credits>\d+(?:\.\d+)?)?(?:\s*-\s*\d+)?\s*$",
    re.IGNORECASE,
)
_RANGE_SUBJECT_FIRST = re.compile(
    rf"^(?P<subject>.+?)\s+courses?\s*\(\s*{_RANGE}\s*(?:;\s*(?P<qual>[^)]*))?\)"
    r"\s*(?P<credits>\d+(?:\.\d+)?)?(?:\s*-\s*\d+)?\s*$",
    re.IGNORECASE,
)
# "FRE, FRW, or FRT courses  9": prefixes named, no level (any undergraduate level).
_PREFIXES_ONLY = re.compile(
    r"^(?P<subject>[A-Z]{3}(?:(?:,\s*|\s+)(?:(?:or|and)\s+)?[A-Z]{3})*)(?:[-\s]+prefixed)?\s+courses?"
    r"\s*(?P<credits>\d+(?:\.\d+)?)(?:\s*-\s*\d+)?\s*$"
)
# "MUH or MUL", "GEA, GEO, GIS, or MET", "RUS and RUW", "EEE or EEL-prefixed".
_PREFIX_LIST_RE = re.compile(r"^[A-Z]{3}(?:(?:,\s*|\s+)(?:(?:or|and)\s+)?[A-Z]{3})*(?:[-\s]+prefixed)?$")
# The one qualifier a row may carry into its pool, as a count rule:
#   "at least two must be 4000 level", "at least three credits at the 4000 level"
_LEVEL_QUALIFIER = re.compile(
    r"^at least (?P<n>\w+)\s*(?P<unit>credits?|courses?)?\s*(?:must be\s*)?(?:at\s*|in\s*)?(?:the\s*)?"
    r"(?P<level>\d)000[-\s]level$",
    re.IGNORECASE,
)


def _qualifier_rule(qual: str, prefixes: tuple[str, ...]) -> dict | None:
    """A count rule for a row's "; at least N ... 4000 level" qualifier, or
    None when the qualifier says anything else (the row is then left alone)."""
    m = _LEVEL_QUALIFIER.match(" ".join(qual.split()).rstrip(". "))
    if not m:
        return None
    n = WORD_NUMBERS.get(m.group("n").lower()) or (int(m.group("n")) if m.group("n").isdigit() else None)
    if not n:
        return None
    unit = "credits" if (m.group("unit") or "").lower().startswith("credit") else "courses"
    return {"at_least": n, "unit": unit, "min_level": int(m.group("level")) * 1000,
            "prefixes": list(prefixes), "text": qual.strip()}


def _subject_prefixes(subject: str) -> tuple[str, ...] | None:
    """Prefixes a row's subject names: a known subject ("Spanish or
    Portuguese" joins two), or prefixes spelled out ("ITA or ITW")."""
    if _PREFIX_LIST_RE.match(subject):
        return tuple(dict.fromkeys(p.lower() for p in re.findall(r"\b[A-Z]{3}\b", subject)))
    names = [n.strip() for n in re.split(r"\s+or\s+|,\s*(?:or\s+)?", subject.lower().replace("’", "'"))]
    found: list[str] = []
    for n in names:
        if n not in SUBJECT_PREFIXES:
            return None
        found.extend(p for p in SUBJECT_PREFIXES[n] if p not in found)
    return tuple(found) or None


def _match_level_wildcard(text: str) -> tuple[tuple[str, ...], int, int, float | None, list[dict]] | None:
    """(prefixes, min_level, max_level, credits, count_rules) for a subject/level
    elective row; a range's low credit ("12-15") is the requirement."""
    cleaned = " ".join(text.split()).strip()
    for pattern in (_WILDCARD_LEVEL_FIRST, _WILDCARD_SUBJECT_FIRST):
        m = pattern.match(cleaned)
        if not m:
            continue
        prefixes = SUBJECT_PREFIXES.get(m.group("subject").strip().lower().replace("’", "'"))
        if not prefixes:
            continue
        credits = m.group("credits")
        return prefixes, int(m.group("level")), 9, float(credits) if credits else None, []
    for pattern in (_RANGE_LEVEL_FIRST, _RANGE_SUBJECT_FIRST):
        m = pattern.match(cleaned)
        if not m:
            continue
        prefixes = _subject_prefixes(m.group("subject").strip())
        if not prefixes:
            continue
        rules: list[dict] = []
        qual = m.groupdict().get("qual")
        if qual and qual.strip():
            rule = _qualifier_rule(qual, prefixes)
            if rule is None:
                return None  # "excluding individual work", "Must be taken at UF": not expressible
            rules.append(rule)
        credits = m.group("credits")
        lo = int(m.group("lo"))
        hi = int(m.group("hi")) if m.group("hi") else lo  # "4000-level X courses": exactly that level
        return prefixes, lo, hi, float(credits) if credits else None, rules
    m = _PREFIXES_ONLY.match(cleaned)
    if m:
        return _subject_prefixes(m.group("subject")), 1, 4, float(m.group("credits")), []
    return None


def expand_subject_elective_groups(
    parsed: ParsedProgram, known_course_ids: set[str], start_sort: int
) -> list[RequirementGroupRow]:
    """Turn '<subject> courses at the N000 level or higher, C credits' rows into
    real choose_credits groups over the catalog.

    Matched placeholders are REMOVED from their original group (they are no
    longer unparsed), and a group left with nothing else is emptied out by the
    caller. Rows whose subject isn't in SUBJECT_PREFIXES, or that state no
    credit count, are left untouched as placeholders — never guessed at.
    """
    new_groups: list[RequirementGroupRow] = []
    sort_order = start_sort
    used_keys = {g.group_key for g in parsed.groups}

    for g in parsed.groups:
        placeholders = g.logic.get("placeholders") or []
        if not placeholders:
            continue
        kept_idx: list[int] = []  # positions kept, so placeholder_credits stays aligned
        moved = 0.0  # credits this group handed to its expanded children
        for i, text in enumerate(placeholders):
            hit = _match_level_wildcard(text)
            if hit is None:
                kept_idx.append(i)
                continue
            prefixes, level, top, credits, rules = hit
            if not credits:
                # No stated credits: the group's own required_credits may cover
                # it, but attributing them here would be a guess. Leave it. A
                # zero minimum ("REL courses (2000 level) 0-6") is optional,
                # not a requirement, so it stays a note too.
                kept_idx.append(i)
                continue
            pool = sorted(
                cid for cid in known_course_ids
                if cid[:3] in prefixes and cid[3:4].isdigit() and level <= int(cid[3]) <= top
            )
            if not pool:
                kept_idx.append(i)
                continue
            slug = re.sub(r"[^a-z0-9]+", "-", " ".join(text.split()).lower()).strip("-")[:60]
            key, n = f"elective-{slug}", 1
            while key in used_keys:  # same row text in two tables gets -2, -3, ...
                n += 1
                key = f"elective-{slug}-{n}"
            used_keys.add(key)
            new_groups.append(RequirementGroupRow(
                group_key=key,
                name=" ".join(text.split()),
                rtype="choose_credits",
                logic={
                    "from": pool,
                    "credits": credits,
                    "derived_from": "subject_level_wildcard",
                    **({"count_rules": rules} if rules else {}),
                    "host_group": g.group_key,
                    "note": (f"{level}000-level or higher" if top == 9 else f"{level}000-{top}999-level")
                            + " courses in "
                            f"{'/'.join(p.upper() for p in prefixes)}",
                },
                eligible_course_ids=pool,
                required_credits=credits,
                required_course_count=None,
                sort_order=sort_order,
                section=g.section,
                raw_html="",
            ))
            sort_order += 1
            moved += credits
        if len(kept_idx) != len(placeholders):
            kept = [placeholders[i] for i in kept_idx]
            if kept:
                g.logic["placeholders"] = kept
            else:
                g.logic.pop("placeholders", None)
            hours = g.logic.get("placeholder_credits")
            if isinstance(hours, list) and len(hours) == len(placeholders):
                if kept:
                    g.logic["placeholder_credits"] = [hours[i] for i in kept_idx]
                else:
                    g.logic.pop("placeholder_credits", None)
            # required_list groups mirror each placeholder as a slot entry
            # ({"placeholder": text}); drop the expanded ones there too, or the
            # row survives as an empty slot the planner can't fill.
            slots = g.logic.get("slots")
            if isinstance(slots, list):
                pruned = [
                    s for s in slots
                    if not (isinstance(s, dict) and "placeholder" in s
                            and s["placeholder"] not in kept)
                ]
                if pruned:
                    g.logic["slots"] = pruned
                else:
                    g.logic.pop("slots", None)
            # The expanded credits now live in the new group; drop them from the
            # host so the program's credit total doesn't double-count.
            if g.required_credits and moved:
                g.required_credits = max(0.0, g.required_credits - moved) or None
                if "credits" in g.logic:  # as link_option_pools does
                    g.logic["credits"] = g.required_credits

    # A host row that existed ONLY to carry wildcard placeholders (e.g. "Political
    # Science Major Electives") is now empty — no slots, no placeholders, no
    # credits. Drop it so the audit doesn't show a blank requirement row.
    if new_groups:
        parsed.groups[:] = [
            g for g in parsed.groups
            if g.eligible_course_ids
            or g.logic.get("placeholders")
            or g.logic.get("slots")
            or g.required_credits
        ]

    return new_groups


def clas_foreign_language_group(language_course_ids: list[str], start_sort: int) -> RequirementGroupRow:
    """CLAS (College of Liberal Arts & Sciences) foreign-language proficiency
    overlay. Placement/prior study can satisfy it for 0 credits; otherwise a
    beginning-language sequence of 8-10 credits. Modeled as a waivable
    choose_credits over the beginning-language courses."""
    return RequirementGroupRow(
        group_key="clas-foreign-language",
        name="Foreign Language Proficiency (CLAS)",
        rtype="choose_credits",
        logic={
            "from": language_course_ids,
            "credits": 8,
            "waived_by": "language_placement_or_proficiency",
            "is_sequence": True,  # options group into per-language beginning sequences
            "note": "0 credits if satisfied by placement or prior study; "
                    "otherwise an 8-10 credit beginning-language sequence",
            # How a student can mark this satisfied on the website. The planner
            # offers these instead of forcing specific course selections.
            "fulfillment_options": [
                {"key": "high_school_proficiency", "label": "High school / prior proficiency", "credits": 0},
                {"key": "placement_exam", "label": "Placement or proficiency exam", "credits": 0},
                {"key": "course_sequence", "label": "Completing a beginning-language sequence",
                 "credits": 8, "partial_progress": True},
            ],
        },
        eligible_course_ids=language_course_ids,
        required_credits=8,
        required_course_count=None,
        sort_order=start_sort,
        section="college",
        raw_html="",
    )


_NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
              "seven": 7, "eight": 8, "nine": 9, "ten": 10}


def _num_token(tok: str) -> int | None:
    tok = tok.lower()
    return int(tok) if tok.isdigit() else _NUM_WORDS.get(tok)


def _parse_course_slots(text: str) -> list[list[list[str]]]:
    """Course clause -> slots (all required = AND). Top level splits on ',' and
    ' and '; within a slot, ' or '/';' separate alternatives (so "one of the
    following: A; or B; or C" is ONE slot with three choices, not three ANDed
    requirements); '/'-joined ids in an alternative are an AND-set (a PHY 2048/
    PHY 2048L lecture+lab pair). Drops "Complete" and "N of the following"
    lead-ins; only course codes survive per alternative."""
    text = re.sub(r"^\s*complete\s+", "", text, flags=re.IGNORECASE)
    # A CONDITIONAL clause is advice about order, not a requirement (s92): the
    # psychology pages print "Complete PSY 2012 ; if MAC 1140 is taken in
    # semester 1, MAC 1114 must be taken semester 2", which read as PSY 2012 or
    # MAC 1140, AND MAC 1114, for every student. Only what precedes it is asked.
    # "If needed" is not that: it only says the row may already be met.
    text = re.split(r"[;,]\s*if\b(?!\s+needed)", text, maxsplit=1, flags=re.IGNORECASE)[0]
    text = _join_paren_sets(text)
    # "… and one of the following: EDF 2110 , DEP 3053 , PSY 2012 or SYG 2000"
    # (Tourism) is ONE member of four alternatives, not three members (s94). A
    # pure run of codes after "one of the following:" reads its commas as "or".
    text = _ONE_OF_RUN_RE.sub(lambda m: m.group(1) + re.sub(r"\s*,\s*(?:or\s+)?", " or ", m.group(2)), text)
    slots: list[list[list[str]]] = []
    for chunk in re.split(r",|\band\b", text):
        chunk = re.sub(r"\b\w+\s+of the following\b:?", "", chunk, flags=re.IGNORECASE)
        # Keep the separators: " or " offers an alternative, ";" (on pages
        # that write "A ; B ; and C") starts a new requirement.
        parts = re.split(r"(;|\bor\b)", chunk)
        alts: list[list[str]] = []
        seps: list[str] = []
        for i in range(0, len(parts), 2):
            ids = [code_to_id(f"{m.group(1)}{m.group(2)}") for m in COURSE_CODE_RE.finditer(parts[i])]
            if ids:
                alts.append(ids)
                seps.append(parts[i - 1].strip().lower() if i else "")
        if not alts:
            continue
        # "CHM 2045 and CHM 2045L" is ONE course with its lab (s91): the
        # residential Biology page writes "CHM 2045 / CHM 2045L" and the UF
        # Online page the same pair with "and", which split the lab into a
        # requirement of its own, so a CHM 1030 student never met it. A chunk
        # that OPENS with the lab of the lecture ending the previous slot joins
        # that arm; what follows an " or " is more alternatives of that slot,
        # what follows a ";" a new slot.
        lab = alts[0]
        if (slots and len(lab) == 1 and lab[0].endswith("l")
                and slots[-1][-1][-1] == lab[0][:-1]):
            slots[-1][-1] = slots[-1][-1] + lab
            rest = list(zip(alts[1:], seps[1:]))
            while rest and rest[0][1] == "or":
                slots[-1].append(rest.pop(0)[0])
            alts = [a for a, _ in rest]
            if not alts:
                continue
        slots.append(alts)
    return slots


_CODE = r"[A-Z]{3}\s?\d{4}[A-Z]?"
_ONE_OF_RUN_RE = re.compile(
    rf"(\b(?:one|1)\s+of\s+the\s+following\s*:\s*)"
    rf"({_CODE}(?:\s*,\s*{_CODE})+\s*,?\s*or\s+{_CODE})(?=\s*(?:$|;|\.))",
    re.IGNORECASE,
)
# "( MAC 1140 and MAC 1114 )", "(or ACG 5637 and ACG 5647 )": a parenthesis
# holding nothing but codes joined by "and" or "/" is ONE arm, taken together.
_PAREN_SET_RE = re.compile(rf"\(\s*(or\s+)?({_CODE}(?:\s*(?:\band\b|/)\s*{_CODE})+)\s*\)", re.IGNORECASE)


def _join_paren_sets(text: str) -> str:
    """s93: a parenthesised AND-set stays one arm. `_parse_course_slots` splits
    on " and " before it reads alternatives, so Accounting's "ACG 4632 (or ACG
    5637 and ACG 5647 )" became ACG 4632 or ACG 5637, AND ACG 5647 (a graduate
    course no board can hold), and "( MAC 1140 and MAC 1114 ) or MAC 1147" made
    MAC 1114 a requirement of its own. Rewritten as "/", which is already how an
    alternative holds a lecture and its lab."""
    def repl(m: re.Match) -> str:
        codes = " / ".join(f"{c.group(1)} {c.group(2)}" for c in COURSE_CODE_RE.finditer(m.group(2)))
        return f" {m.group(1) or ''}{codes} "
    return _PAREN_SET_RE.sub(repl, text)


# A level placeholder: "MUN 1000" (a 1000-level ensemble), "MUL/MUH 3000/4000".
# UF links every real course code on these pages; these are plain text.
_LEVEL_PLACEHOLDER_RE = re.compile(r"^[a-z]{3}\d000$")
_ITEM = rf"{_CODE}(?:\s*/\s*{_CODE})?"
# "GER 3234 , GER 3300 , GER 3413 , or GER 3470": the comma before "or" is
# what makes the run one choice. Without it, "MUH 3211 , MUT 3611 or MUT 4401"
# is MUH 3211 AND one of the other two (Music Composition), so it is required.
_OXFORD_RE = re.compile(rf"{_ITEM}(?:\s*,\s*{_ITEM})*\s*,\s*or\s+{_ITEM}")
# "neuroscience lab: PSB 4343C , EAB 4714C , EXP 4174C", "a Capstone Prep
# Course ( RTV 3108 , … )": a SINGULAR noun introducing a list asks for one.
_SINGULAR_LIST_RE = re.compile(
    rf"(\b(?:lab|course|requirement)\s*[:(]\s*)({_ITEM}(?:\s*,\s*{_ITEM})+(?:\s*,?\s*or\s+{_ITEM})?)",
    re.IGNORECASE)
# "… with minimum grades of C Or 1 core criminology course and 1 law-based
# course": the row is a choice between two COUNTS, which no slot list holds.
_OR_COUNT_RE = re.compile(r"\bor\s+(?:\d+|one|two|three)\s+[a-z-]+(?:\s+[a-z-]+)*?\s+courses?\b", re.IGNORECASE)


def _as_one_choice(run: str) -> str:
    return " or ".join(p.strip() for p in re.split(r"\s*,\s*(?:or\s+)?|\s+or\s+", run) if p.strip())


def _courses_row_slots(text: str, linked: set[str]) -> list[list[list[str]]] | None:
    """A `courses` row's slots, or None when the row is a note (s93). Only the
    courses path reads these rules: s92 tried the Oxford-comma one inside
    `_parse_course_slots` and moved 27 programs, several of them COUNT members,
    because that function builds count lists too.
      - an Oxford-comma run, or a list after a singular noun, is one choice;
      - a choice between two counts, or a parenthesised list that also offers
        something no code names ("or approved biological science course"),
        cannot be counted by its codes, so the row is a note;
      - a slot naming a level placeholder is dropped, whether the placeholder
        is the slot ("MUH 3211 and MUN 3000 Level Ensemble") or one of its
        alternatives ("( GLY 2100C or GLY 3105C ) or GLY 3000-level geology
        course": any such course satisfies it, so the codes cannot count it).
        "MUN 1000 (keyboard emphasis must take MVK 3702 instead)" was one arm of
        both, which no board could hold and which asked everyone for MVK 3702;
      - codes inside "(… recommended)" are advice, as the count path reads them."""
    if _OR_COUNT_RE.search(text):
        return None
    for group in re.findall(r"\(([^()]*)\)", text):
        if (len(_code_ids(group)) >= 2 and _has_prose_option(group)
                and not re.search(r"recommend", group, re.IGNORECASE)):
            return None
    text = re.sub(r"\([^()]*\brecommend[^()]*\)", " ", text, flags=re.IGNORECASE)
    text = _SINGULAR_LIST_RE.sub(lambda m: m.group(1) + _as_one_choice(m.group(2)), text)
    text = _OXFORD_RE.sub(lambda m: _as_one_choice(m.group(0)), text)
    placeholders = {i for i in _code_ids(text) if _LEVEL_PLACEHOLDER_RE.match(i) and i not in linked}
    return [slot for slot in _parse_course_slots(text)
            if not any(placeholders.intersection(arm) for arm in slot)]


def _code_ids(text: str) -> list[str]:
    return [code_to_id(f"{m.group(1)}{m.group(2)}") for m in COURSE_CODE_RE.finditer(text)]


def _flat_ids(members: list) -> list[str]:
    return list(dict.fromkeys(i for member in members for arm in member for i in arm))


@dataclass
class _CountLine:
    """A "Complete N … course(s) …" line, taken apart. See `_classify_count`."""
    n: int  # -1 = all
    additional: bool
    key: str  # which pool: "ct", "business core", or the line's own noun
    of_m: int | None  # the M in "N of [the] M"
    total: int | None  # UF's own "for a total of T"
    listed: list  # members enumerated on THIS line (slot shape)
    has_list: bool
    or_ids: list[str]  # "… course OR STA 2023": widens this row's pool
    and_ids: list[str]  # "… courses AND STA 2023": a required course beside it
    excluded: list[str]
    required: list  # slots named by "including X" / "X must be …"
    within: tuple[int, list] | None  # "(N of the M courses must be taken from LIST)"
    remaining: bool  # "4 of the remaining …": a sub-pool UF never enumerates
    prose_option: bool  # the list offers something no code names ("or any 2000 level ARH …")


def _merge_labs(members: list) -> list:
    """APK counts "BSC 2010 and BSC 2010L" as ONE of its nine courses, so a
    single-arm member followed by its own lab (same id + "l") joins it as an
    AND-set rather than counting as a second member."""
    out: list = []
    for mb in members:
        if (out and len(mb) == 1 and len(mb[0]) == 1 and len(out[-1]) == 1
                and mb[0][0] == out[-1][0][-1] + "l"):
            out[-1] = [out[-1][0] + mb[0]]
            continue
        out.append(mb)
    return out


def _split_unseparated(members: list, of_m: int | None) -> list:
    """A list with no separators between its members ("BSC 2010 / BSC 2010L BSC
    2011 / BSC 2011L CHM 2045 / CHM 2045L CHM 2046 / CHM 2046L ( MAC 1140 and MAC
    1114 ) or MAC 1147 or MAC 2311", Entomology's "2 of 5") reads as ONE slot
    holding every course, so no board could hold it. Each course and its own lab
    is one member; a trailing bare course that opens "( A and B ) or C" joins
    the next slot's first alternative as its AND-set. Only taken when it yields
    exactly the M the line states: that agreement is the evidence, and a list
    that does not reach it is left as it was."""
    if of_m is None or len(members) >= of_m or not members:
        return members
    out: list = []
    for i, mb in enumerate(members):
        if len(mb) != 1 or len(mb[0]) < 2:
            out.append(mb)
            continue
        units: list[list[str]] = []
        for cid in mb[0]:
            if units and cid == units[-1][-1] + "l":
                units[-1].append(cid)
            else:
                units.append([cid])
        out.extend([u] for u in units)
    # "( A and B ) or C": the last bare unit AND-joins the first arm after it.
    if (len(out) >= 2 and len(out[-2]) == 1 and len(out[-2][0]) == 1
            and len(out[-1]) > 1 and len(out[-1][0]) == 1):
        out[-1] = [out[-2][0] + out[-1][0]] + out[-1][1:]
        del out[-2]
    return out if len(out) == of_m else members


def _has_prose_option(listing: str) -> bool:
    """Does a course list also offer an option no course code names? "ARH 2500
    or any 2000 level ARH survey course", "Category A or Category B … or INS
    2004". Such a list cannot be counted by its codes: INS 2004 used to become
    a hard semester-1 deadline off exactly that sentence."""
    rest = COURSE_CODE_RE.sub(" ", listing)
    rest = re.sub(r"\bwith (?:a )?minimum grades? of [a-z][+-]?|\bwith an? [\d.]+ [\w-]+ gpa\b", " ",
                  rest, flags=re.IGNORECASE)
    return bool(re.search(r"\b(any|category|level|courses?|electives?)\b", rest, re.IGNORECASE))


def _of_the_following(n: int, additional: bool, body: str) -> _CountLine | None:
    """"one of the following in BSC, CHM, or MAC: BSC 2010 / BSC 2010L ; CHM
    1025 or CHM 2045 / CHM 2045L ; MAC 1114 , MAC 1140 , MAC 1147 , or MAC
    2311" — a menu whose MEMBERS are separated by ";" and whose commas are
    alternatives within one. Read as a course list it was three required slots
    by semester 1 (Zoology, Biology BS). Only the ";"-separated shape is taken
    here; a single run of alternatives is already one slot, and stays as it
    was."""
    fm = re.match(r"\s*of the following\b[^:]*:(.*)$", body, re.IGNORECASE | re.DOTALL)
    if not fm or n < 1:
        return None
    # "… or MAC 2311 with a 2.5 GPA required for all critical-tracking
    # courses" ends the menu at "with"; the GPA clause is not an option.
    listing = re.split(r"\bwith\b", fm.group(1), flags=re.IGNORECASE)[0]
    parts = [p for p in re.split(r";\s*(?:or\b)?", listing) if _code_ids(p)]
    if len(parts) < 2:
        return None
    members = [
        [ids for alt in re.split(r",|\bor\b", p, flags=re.IGNORECASE) if (ids := _code_ids(alt))]
        for p in parts
    ]
    return _CountLine(
        remaining=False, prose_option=any(_has_prose_option(p) for p in parts), n=n,
        additional=additional, key="of the following", of_m=None, total=None, listed=members,
        has_list=True, or_ids=[], and_ids=[], excluded=[], required=[], within=None,
    )


def _classify_count(text: str) -> _CountLine | None:
    """Read a critical-tracking line that states a COUNT rather than a course
    list, or return None for anything else (which keeps the old handling).

    UF writes these several ways, and until s87 every one but "N of M
    critical-tracking" and "N additional critical-tracking" fell through to a
    `courses` row requiring EVERY course the line named. Finance's semester 1
    ("Complete 2 critical-tracking courses from ACG 2021, …, STA 2023") became
    "all eight by semester 1", and "8 of the 9 …, excluding FIN 3403" became
    "FIN 3403 by semester 4" — the one course the line EXCLUDES. The shapes:
      N of [the] M <noun> courses: LIST      N <noun> courses from LIST
      N additional <noun> course(s) [for a total of T]
      N additional <noun> courses: LIST      one additional … course (LIST)
    plus the clauses that ride on them: "(including ACG 2021)" and "X must be
    …" name a REQUIRED course, "(… recommended)" names nothing, "excluding X"
    leaves X out of the pool, "or STA 2023" widens it."""
    m = re.match(r"\s*complete\s+(all|\w+)\s+(additional\s+)?(.*)$", text, re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    n = -1 if m.group(1).lower() == "all" else _num_token(m.group(1))
    if n is None:
        return None
    body = m.group(3)
    following = _of_the_following(n, bool(m.group(2)), body)
    if following is not None:
        return following
    parens = re.findall(r"\(([^()]*)\)", body)
    # Blank the parentheses at their own width so an index into `main` is an
    # index into `body` — the list is read from `body`, where a bare
    # "CGS 2531 (or ISM 3013)" is an alternative that must survive.
    main = re.sub(r"\([^()]*\)", lambda p: " " * len(p.group(0)), body)
    marker = re.search(r":|\bfrom\b", main)
    head = main[: marker.start()] if marker else re.split(r"\.\s", main)[0]
    course_word = re.search(r"\bcourse(?:s|work)?\b", head, re.IGNORECASE)
    if not course_word:
        return None  # "2 additional credits of MVV 1411", "all other degree requirements"
    rest = head[course_word.end():]
    of_phrase = re.match(
        r"\s*of\s+(?:the\s+)?\d+(?:\s+or\s+\d+)?(?:\s+[^,;:()]*?courses?\b)?", rest, re.IGNORECASE
    )
    key_text = head[: course_word.end()] + (of_phrase.group(0) if of_phrase else "")
    low_key = key_text.lower()
    if "business core" in low_key:
        key = "business core"
    elif re.search(r"critical.tracking|\btracking course|\bcritical course", low_key):
        # Art History's "all additional upper-division tracking courses" is not
        # the lower-division pool it would otherwise carry.
        key = "ct upper division" if re.search(r"upper.division", low_key) else "ct"
    else:
        noun = re.sub(r"^\s*of\s+(?:the\s+)?|\bof\s+(?:the\s+)?\d+\b", " ", low_key)
        noun = COURSE_CODE_RE.sub(" ", noun)
        noun = re.sub(r"\bcourse(?:s|work)?\b|[^a-z' ]", " ", noun)
        key = " ".join(noun.split())
    of_m = None
    om = re.search(r"\bof\s+(?:the\s+)?(\d+)(?:\s+or\s+(\d+))?\b", key_text, re.IGNORECASE)
    if om:
        of_m = max(int(g) for g in om.groups() if g)
    total = re.search(r"total of (\d+)", body, re.IGNORECASE)
    after = rest[of_phrase.end():] if of_phrase else rest
    after = re.split(r"\bwith\b|,|;|\bincluding\b", after, flags=re.IGNORECASE)[0]
    or_split = re.split(r"\bor\b", after, maxsplit=1, flags=re.IGNORECASE)
    and_split = re.split(r"\band\b", after, maxsplit=1, flags=re.IGNORECASE)
    or_ids = _code_ids(or_split[1]) if len(or_split) > 1 else []
    and_ids = _code_ids(and_split[1]) if len(and_split) > 1 else []
    listed: list = []
    has_list = False
    prose_option = False
    if marker:
        # Inside a list a bare ";" separates members (BME: "BSC 2010 ; CHM 2045
        # or CHM 2095 ; …"); only "; or" is the alternative _parse_course_slots
        # reads it as. "with a minimum grade of C" is a per-course qualifier
        # here, not the end of the list (APK names six more courses after it).
        tail = _join_paren_sets(body[marker.end():])
        tail = re.sub(r"\(([^()]*)\)", lambda p: " " * len(p.group(0))
                      if re.search(r"recommend|\bmust\b|\bincluding\b", p.group(1), re.IGNORECASE)
                      else f" {p.group(1)} ", tail)
        # A sentence can end with no period: "… or PSY 3213L Students should
        # take PSY 3213L in semester 3 …" is the list, then advice.
        tail = re.split(r"(?i:\bexcluding\b)|\.\s+(?=[A-Z])|(?<=\d[A-Z])\s+(?=[A-Z][a-z]{2,}\b)"
                        r"|(?<=\d)\s+(?=[A-Z][a-z]{2,}\b)", tail)[0]
        tail = re.sub(r";(?!\s*or\b)", ",", tail)
        listed = _merge_labs(_parse_course_slots(tail))
        listed = _split_unseparated(listed, of_m)
        has_list = bool(listed)
        prose_option = _has_prose_option(tail)
    required: list = []
    within = None
    for p in parens:
        low = p.lower()
        if "recommend" in low:
            continue
        wm = re.search(r"(\w+)\s+of\s+the\s+\d+\s+courses?\s+must\s+be\s+taken\s+from(.*)", p, re.IGNORECASE | re.DOTALL)
        if wm and _num_token(wm.group(1)) is not None:
            within = (_num_token(wm.group(1)) or 0, _parse_course_slots(wm.group(2)))
            continue
        if re.search(r"\bmust\b|\bincluding\b", low):
            seg = next(s for s in p.split(";") if re.search(r"\bmust\b|\bincluding\b", s, re.IGNORECASE))
            seg = re.sub(r"^.*?\bincluding\b", "", seg, flags=re.IGNORECASE)
            # "1 of the 4 courses must be MAC 2233" names it after; "ACG 2071
            # must be completed with a B" names it before.
            after_must = re.sub(r"^.*?\bmust be\b", "", seg, flags=re.IGNORECASE)
            required += _parse_course_slots(after_must if _code_ids(after_must) else seg)
            continue
        if not has_list and _code_ids(p) and "not acceptable" not in low:
            listed = _parse_course_slots(p)  # "one additional … course ( ISS 2290 , … , or ISS 2293 )"
            has_list = bool(listed)
            prose_option = _has_prose_option(p)
    for clause in re.findall(r"\bincluding\b([^:;()]*)", main, re.IGNORECASE):
        required += _parse_course_slots(clause)
    for clause in re.findall(r"\bmust be\b([^:;()]*)", main, re.IGNORECASE):
        required += _parse_course_slots(clause)
    excluded = []
    for clause in re.findall(r"\bexcluding\b([^:;()]*)", main, re.IGNORECASE):
        excluded += _code_ids(clause)
    remaining = bool(re.search(r"\bremaining\b", key_text, re.IGNORECASE))
    return _CountLine(
        remaining=remaining, prose_option=prose_option, n=n, additional=bool(m.group(2)), key=key, of_m=of_m,
        total=int(total.group(1)) if total else None, listed=listed, has_list=has_list,
        or_ids=or_ids, and_ids=and_ids, excluded=excluded, required=required, within=within,
    )


def parse_critical_tracking(soup: BeautifulSoup) -> list[MilestoneRow]:
    """Parse div#criticaltrackingtextcontainer into per-semester milestones.
    Count milestones are CUMULATIVE across semesters (UF phrases them with
    "N additional"); a pool is enumerated once (usually Semester 1) and
    carried, one pool per noun ("critical-tracking" and ACG's "business core"
    are two). A count row's `slots` are its MEMBERS, each a list of UF's " or "
    alternatives, so "MAC 2233 or MAC 2311" is one member either course
    satisfies; `pool` stays the flat id list for older readers. Anything we
    can't classify degrades to a note (the app then falls back to the
    model-plan-derived per-course milestone)."""
    ct = soup.find("div", id="criticaltrackingtextcontainer")
    if ct is None:
        return []
    out: list[MilestoneRow] = []
    pools: dict[str, list] = {}
    running: dict[str, int] = {}
    for header in ct.find_all(["h2", "h3"]):
        m = re.match(r"semester\s+(\d+)", header.get_text(strip=True), re.IGNORECASE)
        if not m:
            continue
        semester = int(m.group(1))
        block = header.find_next_sibling()
        while block is not None and block.name not in ("ul", "ol", "h2", "h3"):
            block = block.find_next_sibling()
        if block is None or block.name in ("h2", "h3"):
            continue
        for li in block.find_all("li", recursive=False):
            text = " ".join(li.get_text(" ", strip=True).replace("\xa0", " ").split())
            low = text.lower()
            if not low.startswith("complete"):
                continue  # GPA / prose lines
            span_ids = [
                code_to_id(s.get_text(strip=True).replace("\xa0", " "))
                for s in li.find_all("span", class_="sc_courseinline")
            ]
            # A list printed as a nested <ul>, one <li> per member (s93,
            # Entomology BS07's "2 of 5"), flattens to one run with nothing
            # between the members. Read it with ";" between them, the separator
            # a count list already treats as a new member. `raw_text` keeps UF's.
            parse_text = text
            nested = [x for sub in li.find_all(["ul", "ol"]) for x in sub.find_all("li", recursive=False)]
            if nested:
                head = " ".join(
                    s.strip() for s in li.find_all(string=True)
                    if not any(p in nested for p in s.parents)
                )
                parse_text = " ".join(f"{head} {' ; '.join(x.get_text(' ', strip=True) for x in nested)}"
                                      .replace("\xa0", " ").split())
            line = _classify_count(parse_text)
            if line is not None:
                out.extend(_count_rows(semester, text, line, pools, running))
                continue
            slots = _courses_row_slots(parse_text, set(span_ids)) if span_ids else []
            if slots:
                out.append(MilestoneRow(semester, "courses", slots=slots, raw_text=text))
            else:
                out.append(MilestoneRow(semester, "note", raw_text=text))
    # "(including ACG 2021)" beside its own "Complete ACG 2021 with a B" row
    # says one thing twice; keep the first statement of a slot per semester.
    seen: set[tuple] = set()
    deduped: list[MilestoneRow] = []
    for row in out:
        if row.kind == "courses":
            slots = [s for s in row.slots if (row.semester, json.dumps(s)) not in seen]
            seen.update((row.semester, json.dumps(s)) for s in slots)
            if not slots:
                continue
            row = MilestoneRow(row.semester, "courses", slots=slots, raw_text=row.raw_text)
        deduped.append(row)
    return deduped


def _count_rows(
    semester: int, text: str, line: _CountLine, pools: dict[str, list], running: dict[str, int]
) -> list[MilestoneRow]:
    """The milestone rows one count line states. The count itself is UF's
    "for a total of T" when printed (a running sum started from a misread line
    was how Finance read 2 and 4 where UF says 4 and 6), else the running sum
    for this pool, else N. A count over a pool nobody enumerated degrades to a
    note, except the critical-tracking pool, which build_data resolves from the
    grid's tracking rows as it always has."""
    rows: list[MilestoneRow] = []
    carried = pools.get(line.key, [])
    members = line.listed if line.has_list else list(carried)
    # A list shorter than the M it claims ("1 of 5 … : THE 4110, THE 4111,
    # THE 4970, Content Creation elective, …") leaves out real options, and a
    # count over the named ones would flag a student who took an unnamed one.
    # Dance's "3 of 12 …: DAA 2104 twice, …" is the other way to get here —
    # twelve TAKES of six courses, which no member count can hold. The count
    # is still UF's, so the running sum advances.
    incomplete = line.has_list and (
        line.prose_option or (line.of_m is not None and line.of_m > len(line.listed))
    )
    # "2 additional major courses: HSC 3201, HSC 4302, or HSC 4800" after
    # "2 major courses: HSC 3032 and HSC 2103" is a FRESH list: two of these
    # three, not four of them. A running sum only continues over the SAME pool.
    fresh = line.has_list and line.listed != carried
    # The list is carried even when its OWN line cannot be counted. It is still
    # the pool UF named, and the lines after it count from it. Dropping it sent
    # Agricultural Education's later rows to the grid's whole set of tracking
    # courses, which the milestone pass then pulled forward, making seven real
    # 3000-level courses late. A later count the named list cannot reach
    # becomes a note below, rather than a target over a pool nobody named.
    if line.has_list:
        pools[line.key] = line.listed
    # "1 of 5 upper division tracking course" after a six-course lower-division
    # list is a DIFFERENT pool that happens to share the noun; an "N of M" with
    # no list of its own must match the carried pool (plus what it excludes).
    carried_ids = {i for mb in carried for arm in mb for i in arm}
    # Finance's "8 of the 9, excluding FIN 3403" counts the excluded course in
    # its M; Economics' "1 additional course of the 4 …, excluding ECO 3101"
    # does not. Either agrees with the carried pool.
    outside = len([i for i in line.excluded if i not in carried_ids])
    mismatched = (not line.has_list and line.of_m is not None and bool(carried)
                  and line.of_m not in (len(carried), len(carried) + outside))
    pool_known = (bool(members) and not incomplete and not mismatched
                  and not (line.remaining and not line.has_list))
    # "1 additional geography course (…) or complete STA 2023": an alternative
    # to a pool we cannot count is not a requirement on either side of the or.
    loose = bool(line.or_ids) and not pool_known
    if pool_known:
        have = {i for member in members for arm in member for i in arm}
        members = members + [[[i]] for i in line.or_ids if i not in have]
        if line.excluded:
            members = [mb for mb in members if not any(i in line.excluded for arm in mb for i in arm)]
    backwards = False
    if line.n == -1:
        count = -1
    elif line.additional and not fresh:
        count = line.total if line.total is not None else running.get(line.key, 0) + line.n
    else:
        count = line.total if line.total is not None else line.n
        # "Complete 1 critical-tracking course" after a running total of 3
        # cannot be absolute — the count would go backwards — and whether it
        # means one MORE is not something the sentence says.
        if (not line.has_list and line.of_m is None and line.total is None
                and count != -1 and count < running.get(line.key, 0)):
            pool_known = False
            backwards = True
    # Agriculture's "1 additional tracking course" three times over, after "all
    # 6", counts courses from a pool UF names nowhere; a count the members can
    # never reach is a different pool, not a requirement to hold them all.
    if pool_known and count > len(members):
        pool_known = False
    # The grid fallback is for a tracking pool UF never enumerates on the page
    # at all. A line that disagrees with the pool it would carry, or counts
    # "the remaining" ones, is a different pool — a note, and the running sum
    # does not move for it.
    unenumerated = (line.key == "ct" and not line.has_list and not carried and not loose
                    and not line.remaining and not backwards)
    if pool_known or unenumerated or incomplete:
        running[line.key] = len(members) if count == -1 else count
    if pool_known:
        rows.append(MilestoneRow(semester, "count", slots=members, count=count,
                                 pool=_flat_ids(members), raw_text=text))
    elif unenumerated:
        rows.append(MilestoneRow(semester, "count", count=count, pool=[], raw_text=text))
    else:
        rows.append(MilestoneRow(semester, "note", raw_text=text))
    if line.within is not None and line.within[1]:
        k, listed = line.within
        rows.append(MilestoneRow(semester, "count", slots=listed, count=k,
                                 pool=_flat_ids(listed), raw_text=text))
    if not loose:
        required = line.required + [[[i]] for i in line.and_ids]
        if required:
            rows.append(MilestoneRow(semester, "courses", slots=required, raw_text=text))
    return rows


# --- Page tabs (changed from UF Planner) --------------------------------------
# A catalog program page is a set of tabs, each an element whose id ends in
# "textcontainer": Overview (the requirements), Model Semester Plan, Critical
# Tracking, and per-program extras. Which tab a course table sits on says what
# it IS, and UF Planner never looked:
#   - "Approved Electives", "Concentration Courses", "Technical Electives", ...
#     list the courses a student may CHOOSE from; the requirement itself (how
#     many credits) is a row on the Overview tab. Parsed as ordinary tables they
#     became required_lists of 60-375 credits (Biology BA, every language BA).
#     UF Planner deleted those groups in its web build; here they are kept as
#     section="options" reference pools that QA does not score.
#   - "Academic Learning Compact" lists the courses where learning outcomes are
#     ASSESSED. It is never a requirement, and is skipped.
# Every other tab (Overview, Core Requirements, Model Semester Plan) parses as
# before.
GENERIC_NAME_RE = re.compile(r"^\s*requirements(?:\s*\(.*\))?\s*$", re.IGNORECASE)
_OPTIONS_TAB_RE = re.compile(r"elective|approved|concentration", re.IGNORECASE)
_SKIP_TAB_RE = re.compile(r"academiclearningcompact|^alc", re.IGNORECASE)


def _table_tab(table: Tag) -> str:
    """The id of the tab container holding a table ("" if none)."""
    container = table.find_parent(id=lambda v: bool(v) and v.endswith("textcontainer"))
    return container.get("id", "") if container is not None else ""


def _pool_heading(table: Tag, heading: str) -> str:
    """An option table's label. When its nearest heading is only the
    instruction ("Select at least one 3 credit course"), the label is the
    heading above that, on the same tab ("Category A | Theories of ...")."""
    # Instruction-only headings: "Select at least one 3 credit course"
    # (ejp_umn), "Minimum 6 credits" under "Plant Production Systems" (pls_bs).
    if not re.match(r"(?i)\s*(?:select|minimum|maximum|up to|at least|choose)\b", heading):
        return heading
    container = table.find_parent(id=lambda v: bool(v) and v.endswith("textcontainer"))
    near = table.find_previous(re.compile(r"^h[2-6]$"))
    above = near.find_previous(re.compile(r"^h[2-6]$")) if near is not None else None
    if above is None or (container is not None and container not in above.parents):
        return heading
    return f"{_cell_text(above)} | {heading}"


def _tab_kind(tab_id: str) -> str:
    if _SKIP_TAB_RE.search(tab_id):
        return "skip"
    if _OPTIONS_TAB_RE.search(tab_id):
        return "options"
    return "requirements"


def _tab_labels(soup: BeautifulSoup) -> dict[str, str]:
    """Tab container id -> the label on its tab ("Approved Electives")."""
    labels: dict[str, str] = {}
    for a in soup.select('a[href^="#"]'):
        target = a["href"][1:]
        text = _cell_text(a)
        if target and text:
            labels.setdefault(target, text)
            labels.setdefault(target.replace("tab", "textcontainer", 1), text)
    return labels


def _option_pool(table: Tag, name: str, tab_label: str, sort_order: int,
                 used_keys: set[str]) -> RequirementGroupRow | None:
    """Every course a table on an options tab lists, as one reference pool."""
    courses: list[str] = []
    for td in table.find_all("td", class_="codecol"):
        courses.extend(c for c in _codes_in_cell(td) if c not in courses)
    if not courses:
        return None
    key = f"options-{_slugify(name)}"
    while key in used_keys:
        m = re.match(r"(.*?)(?:-(\d+))?$", key)
        key = f"{m.group(1)}-{int(m.group(2) or 1) + 1}"
    used_keys.add(key)
    return RequirementGroupRow(
        group_key=key, name=name, rtype="choose_credits",
        logic={"from": courses, "credits": None, "option_pool": True, "tab": tab_label},
        eligible_course_ids=courses, required_credits=None, required_course_count=None,
        sort_order=sort_order, section="options", raw_html="",
    )


_THEME_STOPWORDS = {
    "approved", "elective", "course", "class", "and", "or", "of", "the", "a", "an",
    "select", "at", "least", "one", "two", "three", "list", "from", "upper",
    "division", "tracking", "requirement", "credit", "hour", "additional",
    "major", "minimum", "for", "in", "to",
}


_CATEGORY_RE = re.compile(r"\b(category|group|area)\s+([a-z0-9])\b")


def _theme(text: str) -> frozenset[str]:
    """The words that say WHICH elective a label means: "Approved Technical
    electives (6 credits)" and "Technical Electives | Select 6" are both
    {"technical"}. Parenthesized asides and "| Select ..." tails are dropped,
    plurals folded."""
    text = re.split(r"\s*\|\s*", re.sub(r"\([^)]*\)?", " ", text), maxsplit=1)[0]
    # "Category A" / "Group B" are one word: the letter is what tells them apart.
    text = _CATEGORY_RE.sub(lambda m: f" {m.group(1)}{m.group(2)} ", text.lower())
    text = re.sub(r"\blaboratory\b", "lab", text)  # pls_bs prints both spellings
    words = (w[:-2] if w.endswith("es") and w[:-2] in ("class",) else w.rstrip("s")
             for w in re.findall(r"[a-z0-9]+", text) if not w.isdigit())
    return frozenset(w for w in words if len(w) > 1 and w not in _THEME_STOPWORDS)


# A reservation's menu must offer at least this many courses (across its whole
# run of tables) before it is believed to be a menu; a one- or two-course table
# is more likely a small real requirement. From UF Planner's build_data.py.
_MENU_FLOOR = 3
_RESERVING_LABEL_RE = re.compile(r"(\d+)(?:\s*-\s*\d+)?\s*$")


def _reserves_credits(g: RequirementGroupRow) -> bool:
    """Does this group carry a placeholder row that reserves credits
    ("Approved electives  6")?"""
    slots = g.logic.get("slots")
    if isinstance(slots, list) and any(isinstance(s, dict) and s.get("credits") for s in slots):
        return True
    return any(_RESERVING_LABEL_RE.search(str(t).strip()) for t in g.logic.get("placeholders", []))


def drop_summary_rows(groups: list[RequirementGroupRow]) -> list[RequirementGroupRow]:
    """A summary table restates requirements another table spells out:
    "Primary courses  9 / Additional courses  6" above the "Primary Courses |
    Select 9 credits" and "Additional Courses | Select 6 credits" tables (Mass
    Communication minor). A row whose name AND hours match another group's
    is that group, counted twice; it is dropped, with its hours, from the
    summary group (changed from UF Planner, which counted both)."""
    def plain(text: str) -> str:
        # The whole name, case and plurals folded: a summary row repeats the
        # table's name word for word ("Additional courses" / "Additional
        # Courses"), so _theme's dropped filler words would lose it.
        text = re.split(r"\s*\|\s*", re.sub(r"\([^)]*\)?", " ", text), maxsplit=1)[0]
        text = re.sub(r"[:\s]*\d+(?:\.\d+)?(?:\s*-\s*\d+)?\s*(?:credits?)?\s*$", "", text.strip(), flags=re.I)
        return " ".join(w.rstrip("s") for w in re.findall(r"[a-z]+", text.lower()))

    by_theme: dict[str, list[RequirementGroupRow]] = {}
    for g in groups:
        if g.section == "major" and g.required_credits and plain(g.name):
            by_theme.setdefault(plain(g.name), []).append(g)
    for g in groups:
        slots = g.logic.get("slots")
        if g.section != "major" or not isinstance(slots, list):
            continue
        dupes = [s for s in slots if isinstance(s, dict) and s.get("credits")
                 and any(o is not g and o.required_credits == s["credits"]
                         for o in by_theme.get(plain(s["placeholder"]), []))]
        if not dupes:
            continue
        g.logic["slots"] = [s for s in slots if not any(s is d for d in dupes)]
        texts = {d["placeholder"] for d in dupes}
        kept = [t for t in g.logic.get("placeholders", []) if t not in texts]
        if kept:
            g.logic["placeholders"] = kept
        else:
            g.logic.pop("placeholders", None)
        if g.required_credits:
            g.required_credits = max(0.0, g.required_credits - sum(d["credits"] for d in dupes)) or None
    return [g for g in groups
            if g.section != "major" or g.eligible_course_ids or g.logic.get("placeholders")
            or g.logic.get("slots") or g.required_credits]


def mark_named_tables(groups: list[RequirementGroupRow]) -> list[RequirementGroupRow]:
    """A headerless table whose HEADING names an earlier row is that row's
    list, not a requirement of its own (changed from UF Planner):
      "Select one track: Costume Design Track / Lighting ... / Set ..." and
      then three tables headed "Costume Design Track", ... (Theatre
      Production minor), or "Core courses  6" and a table headed "Core
      Courses" (EU Studies minor).
    Read as requirements they demanded every track at once. They become
    named option pools, which link_option_pools attaches to the row: track
    names (no hours) become one chooser's options; a row with hours becomes a
    chooser over its table. A table's own unparsed rows are kept on the pool
    as "unparsed" so nothing the page lists is lost."""
    named: set[frozenset[str]] = set()
    for g in sorted(groups, key=lambda g: g.sort_order):
        heading = g.logic.get("heading")
        if (g.section == "major" and g.rtype == "required_list" and heading
                and GENERIC_NAME_RE.match(g.name) and g.eligible_course_ids):
            theme = _theme(heading)
            if theme and theme in named:
                unparsed = g.logic.get("placeholders") or []
                g.rtype, g.section, g.required_credits, g.required_course_count = "choose_credits", "options", None, None
                g.logic = {"from": g.eligible_course_ids, "credits": None, "option_pool": True,
                           "named_by_row": True, **({"unparsed": unparsed} if unparsed else {})}
                g.name = heading
                g.group_key = f"options-{_slugify(heading.split('|')[0])}"
                continue
        # Only rows that are clearly references count: one of SEVERAL names
        # under a chooser ("Select one track:"), or a row reserving hours
        # ("Core courses  6"). A lone hourless row can be a sub-heading the
        # builder folded into the group above (faf_ba's "Additional
        # Foundation Coursework"), whose table is a real requirement.
        placeholders = g.logic.get("placeholders", [])
        chooser_names = g.rtype != "required_list" and len(placeholders) >= 2
        for p in placeholders:
            if chooser_names or _RESERVING_LABEL_RE.search(p.strip()):
                if _theme(p):
                    named.add(_theme(p))
    return groups


def mark_reserved_menus(groups: list[RequirementGroupRow], kind: str) -> list[RequirementGroupRow]:
    """Minors and certificates print an elective as a row that reserves credits
    ("Approved electives  6") followed by a bare table of the courses that
    satisfy it, which parses as a required_list of every option (Statistics
    minor: 6 credits reserved, 40 credits "required"). Those tables become
    section="options" pools so link_option_pools can attach them to the row.

    Ported from UF Planner's _drop_reserved_elective_pools (build_data.py),
    changed from UF Planner: it DELETED them at web-build time; here they are
    kept and linked. Its
    guards are kept too: only after a reservation; never a group that reserves
    credits itself; only bare required_lists whose courses are >=75% new to
    the program (a model-plan restatement is not a menu); and the menu floor
    applies to the whole run of tables under one reservation."""
    if kind not in ("minor", "certificate"):
        return groups
    ordered = sorted(groups, key=lambda g: g.sort_order)
    menus: list[RequirementGroupRow] = []
    run: list[RequirementGroupRow] = []
    reserved = False

    def close_run() -> None:
        if sum(len(g.eligible_course_ids) for g in run) >= _MENU_FLOOR:
            menus.extend(run)
        run.clear()

    for g in ordered:
        if g.section != "major":
            continue
        if _reserves_credits(g):
            close_run()
            reserved = True
            continue
        if not reserved or g.rtype != "required_list" or g.logic.get("placeholders"):
            continue
        if g.logic.get("derived_from") == "plangrid" or not g.eligible_course_ids:
            continue
        elsewhere = {c for o in ordered if o is not g for c in o.eligible_course_ids}
        if sum(1 for c in g.eligible_course_ids if c not in elsewhere) < 0.75 * len(g.eligible_course_ids):
            continue
        run.append(g)
    close_run()
    # A menu table with no heading of its own inherits the one above the
    # requirement table ("Required Courses"); only a heading no other group
    # sits under names the menu ("Category A | Theories of ...").
    shared = {o.logic.get("heading") for o in ordered if o not in menus}
    for g in menus:
        g.rtype, g.section, g.required_credits, g.required_course_count = "choose_credits", "options", None, None
        heading = g.logic.get("heading")
        g.logic = {"from": g.eligible_course_ids, "credits": None, "option_pool": True,
                   "reserved_menu": True}
        if heading and heading not in shared and GENERIC_NAME_RE.match(g.name):
            g.name = heading
            g.group_key = f"options-{_slugify(heading.split('|')[0])}"
        if not g.group_key.startswith("options-"):
            g.group_key = f"options-{g.group_key}"
    return groups


def link_option_pools(groups: list[RequirementGroupRow], kind: str = "major",
                      _folded: bool = False) -> list[RequirementGroupRow]:
    """Turn requirement placeholders into real choosers over the option pool
    they name (changed from UF Planner, which discarded these pools).

    The Overview tab or model plan reserves an elective by name and hours
    ("Approved Technical electives  6"); the options tab lists its courses
    under the same name ("Technical Electives"). A placeholder links to a pool
    when their themes (see _theme) are equal and non-empty, or the row's theme
    is a subset of exactly one pool's; or, for a short bare "Approved
    elective(s)" / "major electives" row, when the page has exactly one pool
    and it has no theme of its own (its only name is the tab's: "Approved
    Electives"). Plain "Elective" rows are free electives and never link in
    a major; a minor or certificate has none, so its "Electives 6" row does.

    How a link lands depends on the group holding the placeholder:
    - a required_list (an Overview table or the model plan): every placeholder
      linked to one pool becomes ONE choose_credits group. Its credits are the
      pool heading's own ("Theatre Studies Electives | 9 credits") when it
      states them, else the linked rows' summed hours, else None (an open
      slot). The host loses those rows and hours, as in
      expand_subject_elective_groups.
    - a chooser ("Critical Concentration: 6 credits" whose rows are the
      concentrations): its linked placeholders are ALTERNATIVES, so the pools
      become the chooser's `options` (pick one complete option), the shape
      _GroupBuilder emits for "Option A / Option B" tables. One linked row just
      becomes the chooser's course list.
    A consumed pool leaves the options section: it is a requirement now."""
    pools = [g for g in groups if g.section == "options"]
    if not pools:
        return groups
    # The same table printed twice (eve_bsen's "Engineering Graphics or GIS")
    # would make its name ambiguous: fold same-named pools into the first.
    # Only names that say something: two menus both called "Requirements" (a
    # minor's Category A and Category B lists) are different menus.
    by_name: dict[str, RequirementGroupRow] = {}
    for p in pools:
        first = by_name.setdefault(p.name.strip().lower() if _theme(p.name) else str(id(p)), p)
        if first is not p:
            first.eligible_course_ids.extend(c for c in p.eligible_course_ids
                                             if c not in first.eligible_course_ids)
            first.logic["from"] = first.eligible_course_ids
            groups = [g for g in groups if g is not p]
    pools = list(by_name.values())
    themes = {id(p): _theme(p.name) for p in pools}
    bare = [p for p in pools if not themes[id(p)]]

    def pool_for(text: str) -> RequirementGroupRow | None:
        theme = _theme(text)
        # A row naming exactly one category ("Category A elective: Social
        # Identities ...") belongs to the one pool labelled with it.
        cats = {w for w in theme if re.fullmatch(r"(?:category|group|area)[a-z0-9]", w)}
        if len(cats) == 1:
            hits = [p for p in pools if cats <= themes[id(p)]]
            if len(hits) == 1:
                return hits[0]
        if theme:
            # Equal themes, else every word the placeholder names appears in
            # exactly one pool's name ("Specialization Elective" -> "Costume
            # Specialization Electives"). Never the other way round: "AFA-
            # prefixed courses 3000+" must not land in "AFA-Approved Courses".
            hits = ([p for p in pools if themes[id(p)] == theme]
                    or [p for p in pools if themes[id(p)] and theme <= themes[id(p)]])
            if len(hits) == 1:
                return hits[0]
        # The bare rule is for short labels; a sentence that happens to say
        # "major electives" ("Of the 18 credits of major electives, ...") is a
        # note about the requirement, not the requirement.
        # Minors and certificates have no free electives, so there any row
        # that reserves elective credits ("Electives 6-7", "Specialization
        # electives 6") means the page's one menu.
        if len(pools) == 1 and bare and len(text.split()) <= 8 and (
                re.search(r"\bapproved\b|\bmajor electives?\b", text, re.IGNORECASE)
                or (kind != "major" and re.search(r"\belectives?\b", text, re.IGNORECASE)
                    and _RESERVING_LABEL_RE.search(text.strip()))):
            return bare[0]
        return None

    consumed: set[int] = set()
    new_groups: dict[int, RequirementGroupRow] = {}  # id(pool) -> its requirement group
    for g in groups:
        if g.section != "major":
            continue
        slots = g.logic.get("slots")
        if isinstance(slots, list):
            entries = [s for s in slots if isinstance(s, dict) and "placeholder" in s]
        else:
            hours = g.logic.get("placeholder_credits") or []
            entries = [{"placeholder": t, **({"credits": hours[i]} if i < len(hours) and hours[i] else {})}
                       for i, t in enumerate(g.logic.get("placeholders", []))]
            # An empty open chooser is its own row: "Mathematics BA Major
            # Electives: 12 credits" over nothing, when the Approved Electives
            # tab is the list it means.
            if g.logic.get("open_electives") and not g.eligible_course_ids and not entries:
                entries = [{"placeholder": re.sub(r"[:\s]*\d+(?:\.\d+)?\s*credits?\s*$", "", g.name,
                                                  flags=re.IGNORECASE), "self": True}]
        links = [(e, p) for e in entries if (p := pool_for(e["placeholder"])) is not None]
        if not links:
            continue
        texts = {e["placeholder"] for e, _ in links}
        kept = [t for t in g.logic.get("placeholders", []) if t not in texts]
        if "placeholder_credits" in g.logic:
            hours = dict(zip(g.logic["placeholders"], g.logic["placeholder_credits"]))
            g.logic["placeholder_credits"] = [hours.get(t) for t in kept]
            if not kept or not any(g.logic["placeholder_credits"]):
                g.logic.pop("placeholder_credits")
        if kept:
            g.logic["placeholders"] = kept
        else:
            g.logic.pop("placeholders", None)

        # A required list can be a chooser in disguise: "Select six credits
        # from one area:" (a number in words, so _parse_select missed it)
        # followed by the areas' names, none with hours of its own (faf_ba).
        instruction = next((e for e in entries if e not in [x for x, _ in links]
                            and re.match(r"\s*select\b.*\bone\b", e["placeholder"], re.IGNORECASE)), None)
        if (g.rtype == "required_list" and instruction is not None
                and len({id(p) for _, p in links}) >= 2
                and all(e.get("credits") is None for e, _ in links)):
            credits = instruction.get("credits")
            g.rtype, g.required_credits, g.required_course_count = "choose_credits", credits, None
            g.logic.pop("slots", None)
            g.logic["credits"] = credits
            rest = [t for t in g.logic.get("placeholders", []) if t != instruction["placeholder"]]
            if rest:
                g.logic["placeholders"] = rest
            else:
                g.logic.pop("placeholders", None)
            g.logic["instruction"] = instruction["placeholder"]

        # Under a chooser, rows without hours are ALTERNATIVES (concentration
        # names); rows that each carry hours are PARTS of the header's credits
        # and link one by one, like a required list's rows.
        if g.rtype != "required_list" and not all(e.get("credits") for e, _ in links):
            options: list[RequirementGroupRow] = []
            for _, p in links:
                if p not in options:
                    options.append(p)
            consumed.update(id(p) for p in options)
            ids: list[str] = list(g.eligible_course_ids)
            for p in options:
                ids.extend(c for c in p.eligible_course_ids if c not in ids)
            g.eligible_course_ids = ids
            g.logic.pop("open_electives", None)
            if len(options) == 1:
                g.logic["from"] = ids
            else:
                g.logic.pop("from", None)
                g.logic["options"] = [p.eligible_course_ids for p in options]
                g.logic["option_labels"] = [p.name for p in options]
            g.logic["linked_from"] = [e["placeholder"] for e, _ in links]
            continue

        if isinstance(slots, list):
            g.logic["slots"] = [s for s in slots if not any(s is e for e, _ in links)]
        moved = sum(e.get("credits") or 0.0 for e, _ in links)
        if g.required_credits and moved:
            g.required_credits = max(0.0, g.required_credits - moved) or None
            if "credits" in g.logic:
                g.logic["credits"] = g.required_credits
        for e, p in links:
            consumed.add(id(p))
            target = new_groups.get(id(p))
            if target is None:
                target = new_groups[id(p)] = p
                p.rtype, p.section, p.sort_order = "choose_credits", "major", g.sort_order
                # host_group: the requirement row this came from, so the page's
                # "Total Credits" check still counts the credits it carries.
                p.logic = {"from": p.eligible_course_ids, "credits": None, "linked_from": [],
                           "host_group": g.group_key, "tab": p.logic.get("tab"), "_summed": None}
            target.logic["linked_from"].append(e["placeholder"])
            if e.get("credits") is not None:
                target.logic["_summed"] = (target.logic["_summed"] or 0.0) + e["credits"]

    taken_keys = {g.group_key for g in groups}
    for p in new_groups.values():
        summed = p.logic.pop("_summed")
        stated = _CREDITS_IN_NAME_RE.search(p.name)
        credits = float(stated.group(1)) if stated else summed
        p.logic["credits"] = p.required_credits = credits
        if credits is None:
            p.logic["open_electives"] = True
        bare_key = p.group_key.replace("options-", "", 1)
        if bare_key not in taken_keys:
            p.group_key = bare_key
    out = [g for g in groups if g.section != "options" or id(g) not in consumed]
    # A host left with nothing (it only carried the linked placeholders) goes.
    out = [g for g in out
           if g.section != "major" or g.eligible_course_ids or g.logic.get("placeholders")
           or g.logic.get("slots") or g.required_credits]

    # Second pass: an "Approved Electives" tab split into category tables
    # (Marine Sciences: Ecology / Economics / Oceanography / ...) that no row
    # names one by one, while a row asks for "Approved marine sciences
    # electives  18": the row means the whole tab. Fold the tab's leftover
    # pools into one and link again (once).
    leftover = [g for g in out if g.section == "options"]
    tabs = {g.logic.get("tab") or "" for g in leftover}
    wants_tab = any(re.search(r"\bapproved\b.*\belectives?\b", t, re.IGNORECASE)
                    and _RESERVING_LABEL_RE.search(t.strip())
                    for g in out if g.section == "major" for t in g.logic.get("placeholders", []))
    if (not _folded and len(leftover) >= 2 and len(tabs) == 1 and wants_tab
            and re.search(r"approved", next(iter(tabs)), re.IGNORECASE)):
        first = leftover[0]
        for p in leftover[1:]:
            first.eligible_course_ids.extend(c for c in p.eligible_course_ids if c not in first.eligible_course_ids)
        first.name = next(iter(tabs))
        first.logic = {"from": first.eligible_course_ids, "credits": None, "option_pool": True,
                       "tab": first.name, "folded": [p.name for p in leftover]}
        out = [g for g in out if g.section != "options" or g is first]
        return link_option_pools(out, kind, _folded=True)
    return out


def page_fingerprint(html: str) -> str:
    """A short hash of a program page's own content (changed from UF Planner,
    which had no way to notice a page changing under an override).

    Every content tab on a catalog program page is an element whose id ends in
    "textcontainer" (overview, requirements, model plan, critical tracking,
    concentrations...). Their whitespace-normalized text is hashed; site
    navigation, scripts and the page chrome are not, so a catalog-wide rebuild
    that leaves this program's text alone keeps the same fingerprint. HTTP
    Last-Modified can't do this job: UF rebuilds every page at once."""
    soup = BeautifulSoup(html, "html.parser")
    parts = [" ".join(el.get_text(" ", strip=True).split())
             for el in soup.select('[id$="textcontainer"]')]
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()[:16]


def parse_program_page(html: str, url: str, kind: str | None = None) -> ParsedProgram:
    """kind: major | minor | certificate when the caller knows it (the program
    index does); otherwise it is guessed from the URL and title. It must be
    known here, not patched on afterwards: mark_reserved_menus and
    link_option_pools treat minors and certificates differently."""
    soup = BeautifulSoup(html, "html.parser")
    h1 = soup.find("h1")
    page_name = _cell_text(h1) if h1 else url
    record = program_identity(url, page_name)
    if kind:
        record.kind = kind

    # The full model-plan grid, parsed first: when it spells out a complete
    # curriculum (SUBSTANTIAL_GRID+ concrete courses) it is authoritative, and a
    # redundant by-department elective table (aro's "Technical Electives") can be
    # skipped rather than mis-parsed into required groups.
    plan: list[PlanRow] = []
    plangrid = soup.select_one("table.sc_plangrid")
    if plangrid is not None:
        plan = parse_plangrid(plangrid)
    grid_courses = sum(1 for r in plan if r.course_id)

    tables_ctx = [
        (t, _preceding_heading(t), _preceding_intro(t))
        for t in soup.select("table.sc_courselist")
    ]
    # aro case: a page with a SUBSTANTIAL plan grid whose course-list tables are
    # nothing but an elective dump organised into plain by-department / by-theme
    # sub-lists — the grid is the real curriculum, the tables just enumerate
    # elective options. Treat the grid as authoritative (plan-derived below) and
    # skip every elective table, rather than mis-parse 18 "required department"
    # groups. Gated on the plain-sub-list signature so ordinary programs whose
    # electives are a simple chooser are untouched.
    redundant_dump = grid_courses >= SUBSTANTIAL_GRID and any(
        _is_elective_context(h, i) and _plain_areaheaders(t) >= 2 for t, h, i in tables_ctx
    )

    groups: list[RequirementGroupRow] = []
    used_keys: set[str] = set()
    total: float | None = None
    total_keys: list[str] = []
    tab_labels = _tab_labels(soup)
    for table, heading, intro in tables_ctx:
        tab_id = _table_tab(table)
        tab_kind = _tab_kind(tab_id)
        if tab_kind == "skip":
            log.debug("skipping table on the %r tab (learning outcomes, not requirements)", tab_id)
            continue
        if tab_kind == "options":
            pool = _option_pool(table, _pool_heading(table, heading) or tab_labels.get(tab_id, tab_id),
                                tab_labels.get(tab_id, tab_id), len(groups), used_keys)
            if pool is not None:
                groups.append(pool)
            continue
        # A whole table under a "Recommended Coursework" <h2> is optional
        # suggestions, not requirements — its headerless courselist would
        # otherwise become a phantom required "Requirements" group (eco_ba).
        if _recommended_only(heading):
            log.info("skipping recommended-coursework table under heading %r", heading)
            continue
        elective = _is_elective_context(heading, intro)
        if redundant_dump and elective:
            continue
        parsed, table_total = parse_courselist(table, used_keys, heading, intro, elective)
        # Later tables continue the numbering so sort_order stays global.
        for g in parsed:
            g.sort_order += len(groups)
            # A headerless table's groups are all "Requirements"; keep the
            # heading over the table so a menu can still be named by it.
            if heading and GENERIC_NAME_RE.match(g.name):
                g.logic["heading"] = heading
        groups.extend(parsed)
        if table_total is not None and total is None:
            total = table_total
            total_keys = [g.group_key for g in parsed]

    groups = _merge_credit_header_with_pool(groups)

    # Plan-derived core: no course-list groups at all, OR the only groups left
    # after skipping redundant elective tables are gen-ed/tracking (the required
    # major coursework lives solely in the grid, as on the aro page).
    if plan and not any(g.section == "major" for g in groups):
        groups = [*derive_group_from_plan(plan), *groups]
    groups = drop_summary_rows(link_option_pools(mark_reserved_menus(mark_named_tables(groups), record.kind), record.kind))
    total_keys += [g.group_key for g in groups
                   if g.logic.get("host_group") in total_keys and g.group_key not in total_keys]

    milestones = parse_critical_tracking(soup)

    return ParsedProgram(
        program=record, groups=groups, plan=plan, milestones=milestones,
        total_credits=total, total_credit_keys=total_keys,
        fingerprint=page_fingerprint(html),
    )


_NAME_STOPWORDS = {"and", "of", "the", "for", "a", "in", "coursework", "courses", "course", "credits", "credit"}


def _name_theme(name: str) -> tuple[str, ...]:
    """First two significant tokens of a group name, for theme matching."""
    toks = [t for t in re.findall(r"[a-z0-9]+", name.lower()) if t not in _NAME_STOPWORDS]
    return tuple(toks[:2])


def _merge_credit_header_with_pool(
    groups: list[RequirementGroupRow],
) -> list[RequirementGroupRow]:
    """Cross-table cleanup: a requirement stated as a credit-bearing header with
    no course list of its own ("Theories and Applications Coursework: 9 Credits")
    plus a later pooled chooser of the same theme, built from the option table it
    refers to ("Theories & Applications" -> the 47 course options), are the SAME
    requirement split across two tables. Fold the pool's courses into the header
    (keeping the header's stated credits) and drop the now-duplicate pool. Gated
    on a two-token theme match so unrelated groups are never merged."""
    # Changed from UF Planner: a group whose own rows reserve hours ("Additional
    # 3000-4000-level zoology elective courses 11" on zly_bs, "4000-level
    # Spanish courses 12" on hll_ba01) is a requirement already, not an empty
    # header; merging it took a same-themed chooser's courses and credits.
    headers = [
        g for g in groups
        if not g.eligible_course_ids and g.section == "major"
        and _CREDITS_IN_NAME_RE.search(g.name)
        and not any(isinstance(s, dict) and s.get("credits") for s in g.logic.get("slots") or [])
    ]
    if not headers:
        return groups
    drop: set[int] = set()
    for h in headers:
        theme = _name_theme(h.name)
        if len(theme) < 2:
            continue
        for g in groups:
            # An option-tab pool needs its WHOLE name in the header ("Theories
            # & Applications" in "Theories and Applications Coursework: 9
            # credits"): two shared words are not enough ("Marine Sciences
            # Core Elective" is not "Marine Sciences Major Electives").
            if g is h or id(g) in drop or not g.eligible_course_ids:
                continue
            if g.section == "options" and not (_theme(g.name) and _theme(g.name) <= _theme(h.name)):
                continue
            if g.rtype in ("choose_credits", "choose_n") and _name_theme(g.name) == theme:
                credits = float(_CREDITS_IN_NAME_RE.search(h.name).group(1))
                h.rtype = "choose_credits"
                h.eligible_course_ids = list(g.eligible_course_ids)
                h.logic = {"from": list(g.eligible_course_ids), "credits": credits}
                h.required_credits = credits
                h.required_course_count = None
                drop.add(id(g))
                break
    return [g for g in groups if id(g) not in drop]


def parse_track_links(html: str, url: str, base_url: str) -> list[dict]:
    """Hub pages (Animal Sciences, Music) keep their requirements on
    track/specialization subpages linked from the page nav — return those as
    [{name, url}]. Only direct children of this program's path count; PDF
    downloads and anchor variants are ignored."""
    m = re.search(r"(/UGRD/colleges-schools/[A-Za-z0-9_/]+?)/?$", url)
    if not m:
        return []
    base_path = m.group(1)
    soup = BeautifulSoup(html, "html.parser")
    out: dict[str, str] = {}
    for a in soup.select("a[href]"):
        href = a.get("href", "").split("#")[0].split("?")[0]
        if not href.startswith(base_path + "/"):
            continue
        rest = href[len(base_path):].strip("/")
        if not rest or "/" in rest or "." in rest:
            continue  # self-link, deeper nesting, or a .pdf download
        name = _cell_text(a)
        out.setdefault(href.rstrip("/") + "/", name or rest)
    return [{"name": n, "url": f"{base_url}{h}"} for h, n in out.items()]


def parse_programs_index(html: str, base_url: str) -> list[dict]:
    """The /UGRD/programs/ index -> [{name, url, kind, college_slug}].

    Every link into /UGRD/colleges-schools/<COLLEGE>/<CODE>/ counts as a
    program; kind falls back to the link text ("... Minor", "... Certificate")
    when the code suffix is ambiguous.
    """
    soup = BeautifulSoup(html, "html.parser")
    out: dict[str, dict] = {}
    for a in soup.select("a[href]"):
        m = PROGRAM_URL_RE.search(a.get("href", ""))
        if not m:
            continue
        url = f"{base_url}{m.group(0).rstrip('/')}/"
        text = _cell_text(a)
        record = program_identity(url, text)
        if "minor" in text.lower():
            record.kind = "minor"
        elif "certificate" in text.lower():
            record.kind = "certificate"
        out.setdefault(record.id, {
            "id": record.id,
            "name": record.name,
            "url": url,
            "kind": record.kind,
            "college_slug": record.college_slug,
        })
    return list(out.values())
