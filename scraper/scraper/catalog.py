"""Parse catalog.ufl.edu course pages into course records and requisite trees.

Pure functions only: HTML in, records out. Fetching and writing files happen in
run.py, so everything here can be tested against saved pages.

Pages read:
- the course index (/UGRD/courses/), which links every department page;
- a department page, which holds one div.courseblock per course and, in its
  header, the catalog year ("2026-2027 Catalog").

Prerequisites and corequisites are parsed into an expression tree (see the
"Requisite parser" section). Anything the parser does not recognize becomes an
"unparsed" leaf holding UF's original words, so nothing is ever dropped.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from bs4 import BeautifulSoup

from . import ids

log = logging.getLogger("scraper.catalog")


# ============================================================================
# Records
# ============================================================================

@dataclass
class Requisite:
    """A parsed prerequisite or corequisite line."""

    raw_text: str          # exactly what UF wrote, whitespace-normalized
    tree: dict             # expression tree (see "Requisite parser")
    status: str            # "complete" | "partial" | "unparsed"
    mentions: list[str]    # every course id the text names, in order


@dataclass
class Course:
    id: str                         # "cop3502c"
    code: str                       # "COP 3502C"
    name: str
    credits_min: float | None       # None = UF printed no credits
    credits_max: float | None       # equals credits_min unless variable ("1-4 Credits")
    description: str
    grading: str | None             # "letter" | "su" | None
    gen_ed: list[str] = field(default_factory=list)            # ids.GEN_ED_AREAS codes
    quest: list[str] = field(default_factory=list)             # ids.QUEST_LEVELS codes
    writing_words: int = 0                                     # "Satisfies 6000 Words of Writing Requirement"
    other_attributes: list[str] = field(default_factory=list)  # e.g. "Artificial Intelligence"
    prereq: Requisite | None = None
    coreq: Requisite | None = None
    dept_slug: str = ""


@dataclass
class DepartmentPage:
    catalog_year: str | None        # "2026-2027", or None if the header could not be read
    courses: list[Course]


# ============================================================================
# Course index and catalog year
# ============================================================================

_DEPT_HREF_RE = re.compile(r"^/UGRD/courses/([a-z0-9_-]+)/$")
_CATALOG_YEAR_RE = re.compile(r"\b(20\d\d)\s*-\s*(20\d\d)\s+(?:Academic\s+)?Catalog\b")


def parse_course_index(html: str) -> dict[str, str]:
    """Department slug -> department name, for every page the index links."""
    soup = BeautifulSoup(html, "html.parser")
    departments: dict[str, str] = {}
    for a in soup.select("a[href]"):
        m = _DEPT_HREF_RE.match(a["href"])
        if m:
            departments.setdefault(m.group(1), _text(a))
    return departments


def _catalog_year(soup: BeautifulSoup) -> str | None:
    """The catalog year printed on the page, or None if absent or ambiguous."""
    years = {f"{a}-{b}" for a, b in _CATALOG_YEAR_RE.findall(soup.get_text(" "))}
    if len(years) == 1:
        return years.pop()
    if years:
        log.warning("page shows several catalog years %s", sorted(years))
    return None


# ============================================================================
# Department pages
# ============================================================================

_CREDITS_RE = re.compile(r"(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*Credits?", re.IGNORECASE)
_CODE_PREFIX_RE = re.compile(r"^[A-Z]{3}\s?\d{4}[A-Z]?\s*")
_GEN_ED_PREFIX_RE = re.compile(r"^General Education\s*[-–]\s*", re.IGNORECASE)
_WRITING_RE = re.compile(r"^Satisfies\s+(\d[\d,]*)\s+Words of Writing Requirement$", re.IGNORECASE)
_GRADING = {"letter grade": "letter", "s/u": "su"}


def parse_department_page(html: str, dept_slug: str) -> DepartmentPage:
    soup = BeautifulSoup(html, "html.parser")
    courses = []
    for block in soup.select("div.courseblock"):
        course = _parse_block(block, dept_slug)
        if course is not None:
            courses.append(course)
    return DepartmentPage(_catalog_year(soup), courses)


def _text(el) -> str:
    """An element's visible text with all whitespace collapsed to single spaces."""
    return " ".join(el.get_text(" ", strip=True).split()) if el else ""


def _parse_block(block, dept_slug: str) -> Course | None:
    title = _text(block.select_one(".courseblocktitle"))
    credits_text = _text(block.select_one(".courseblocktitle .credits"))

    code_ids = ids.find_course_ids(title)
    if not code_ids:
        log.warning("%s: skipping a course block with no course code: %r", dept_slug, title[:80])
        return None
    course_id = code_ids[0]

    # The title reads "EVS 1010 First Year Environmental Science 1 Credit":
    # drop the credits from the end and the code from the front.
    name = _CODE_PREFIX_RE.sub("", title.removesuffix(credits_text).strip())

    credits_min = credits_max = None
    if m := _CREDITS_RE.search(credits_text):
        credits_min = float(m.group(1))
        credits_max = float(m.group(2)) if m.group(2) else credits_min
    else:
        log.warning("%s: no credits printed", course_id)

    course = Course(
        id=course_id,
        code=ids.id_to_code(course_id),
        name=name,
        credits_min=credits_min,
        credits_max=credits_max,
        description=_text(block.select_one(".courseblockdesc")),
        grading=None,
        dept_slug=dept_slug,
    )

    # Every other field is <p class="courseblockextra"><strong>Label:</strong> value</p>.
    for extra in block.select(".courseblockextra"):
        label_text = _text(extra.find("strong"))
        label = label_text.rstrip(":").lower()
        value = _text(extra).removeprefix(label_text).strip()
        if label == "grading scheme":
            course.grading = _GRADING.get(value.lower())
            if course.grading is None:
                log.warning("%s: unknown grading scheme %r", course_id, value)
        elif label.startswith("prerequisite"):
            course.prereq = parse_requisite(value)
        elif label.startswith("corequisite"):
            course.coreq = parse_requisite(value)
        elif label.startswith("attribute"):
            _apply_attributes(course, value)
        else:
            log.warning("%s: unknown course field %r", course_id, label)
    return course


def _apply_attributes(course: Course, value: str) -> None:
    """'General Education - Humanities, Quest 1, Satisfies 2000 Words of ...'"""
    for item in (part.strip() for part in value.split(",")):
        if not item:
            continue
        if _GEN_ED_PREFIX_RE.match(item):
            area = ids.gen_ed_from_label(_GEN_ED_PREFIX_RE.sub("", item))
            if area is None:
                log.warning("%s: unknown Gen Ed label %r", course.id, item)
            elif area not in course.gen_ed:
                course.gen_ed.append(area)
        elif quest := ids.quest_from_label(item):
            if quest not in course.quest:
                course.quest.append(quest)
        elif m := _WRITING_RE.match(item):
            course.writing_words = int(m.group(1).replace(",", ""))
        else:
            course.other_attributes.append(item)


# ============================================================================
# Requisite parser
# ============================================================================
# UF writes requisites as English with course codes in it:
#   "( BSC 2005 or BSC 2010 with minimum grades of C-) and ( CHM 2045 or
#    CHM 2047 , or equivalent with minimum grades of C-)."
# We turn that into a tree in six passes:
#   0. rewrite        known boilerplate phrases -> a form the grammar reads
#   1. tokenize       text -> course / grade / text / and / or / comma / ( / )
#   2. attach grades  a grade sets min_grade on the courses just before it
#   3. merge text     adjacent words -> one phrase; filler-only phrases dropped
#   4. resolve commas each comma becomes the AND or OR that follows it
#   5. parse          recursive descent; OR binds tighter than AND
#
# Tree nodes are dicts with a "type" key:
#   {"type": "and" | "or", "items": [node, ...]}
#   {"type": "course", "course_id": "bsc2010", "min_grade": "C-", "or_s": true}
#        (min_grade and or_s only when UF states them)
#   {"type": "standing", "level": "junior", "or_higher": true}
#   {"type": "program", "code": "EVS_BA"}  or  {"type": "program", "name": "Dance", "kind": "major"}
#   {"type": "gpa", "min": 3.75, "scope": "upper division"}       (scope optional)
#   {"type": "credits", "min": 60}
#   {"type": "permission", "who": "instructor" | "department" | "coordinator" | "other", "text": ...}
#   {"type": "placement", "text": ...}      an exam/test score alternative
#   {"type": "equivalent"}                  "or equivalent": an advisor's judgment
#   {"type": "unparsed", "text": ..., "mentions": [...]}

# Fixed phrases UF repeats verbatim, rewritten before tokenizing. Each was found
# by counting the most common unparsed phrases across every department page.
_REWRITES = [
    # 113 courses. "enrollment, test, or transfer credit" lists where the 15
    # credits may come FROM; read literally, the commas split it into alternatives.
    (re.compile(r"\bminimum (\d+) credits earned in enrollment, test, or transfer credit\b", re.IGNORECASE),
     r"\1 credits"),
]

_TOKEN_RE = re.compile(
    r"""
      (?P<grade>
          (?:(?:both|all|each)\s+)?(?:with\s+)?(?:an?\s+)?(?:minimum\s+)?grades?\s+of\s+
              (?P<g1>[A-D][+-]?)(?:\s+or\s+(?:better|higher|above))?
        | \(\s*(?P<g2>[A-D][+-]?)\s+or\s+(?:better|higher|above)\s*\)
        | (?:with\s+)?(?:an?\s+)?\b(?P<g3>(?-i:[A-D][+-]?))\s+or\s+(?:better|higher|above)\b
      )
    | (?P<or_s>,?\s*or\s+(?-i:S)\b(?=\s*(?:,|\.|;|\)|$)))
    | (?P<course>(?-i:\b[A-Z]{3}\s?\d{4}[A-Z]?\b))
    | (?P<or_higher>\bor\s+(?:higher|above|better|greater|more)\b)
    | (?P<andor>\band/or\b)
    | (?P<slash>/\s*(?=[A-Z]{3}\s?\d{4}))
    | (?P<lp>\()
    | (?P<rp>\))
    | (?P<and>\band\b|&|;|\.(?=\s|$))
    | (?P<or>\bor\b)
    | (?P<comma>,)
    | (?P<word>\d+\.\d+|[^\s(),;&.]+)
    """,
    re.VERBOSE | re.IGNORECASE,
)

# Words that mean nothing on their own ("either A or B", "both A and B").
_FILLER = {"either", "both", "all", "each", "one", "of", "the", "following", "completion",
           "successful", "courses", "course", "a", "an", "in", "with", "and", "or"}


def parse_requisite(raw: str) -> Requisite:
    raw = " ".join(raw.split()).strip()
    text = raw
    for pattern, replacement in _REWRITES:
        text = pattern.sub(replacement, text)
    tokens = _tokenize(text)
    tokens = _attach_grades(tokens)
    tokens = _merge_text(tokens)
    tokens = _resolve_commas(tokens)
    tree = _Parser(tokens).parse()
    if tree is None:  # nothing but filler words
        tree = {"type": "unparsed", "text": raw, "mentions": ids.find_course_ids(raw)}
    tree = _simplify(tree)
    return Requisite(raw_text=raw, tree=tree, status=_status(tree), mentions=_mentions(tree))


# --- pass 1: tokenize -----------------------------------------------------------

def _tokenize(text: str) -> list[list]:
    """[[kind, value], ...]. A course token's value is its leaf node."""
    tokens: list[list] = []
    for m in _TOKEN_RE.finditer(text):
        kind = m.lastgroup
        if m.group("grade"):
            tokens.append(["grade", (m.group("g1") or m.group("g2") or m.group("g3")).upper()])
        elif kind == "or_s":
            tokens.append(["or_s", None])
        elif kind == "course":
            tokens.append(["course", {"type": "course", "course_id": ids.code_to_id(m.group())}])
        elif kind in ("andor", "slash"):
            tokens.append(["or", None])
        elif kind in ("or_higher", "word"):
            tokens.append(["text", m.group()])
        else:
            tokens.append([kind, None])
    return tokens


# --- pass 2: attach grades -------------------------------------------------------

def _attach_grades(tokens: list[list]) -> list[list]:
    """'A or B with minimum grades of C-': both A and B get min_grade C-.

    A grade covers every not-yet-graded course since the previous grade at the
    same parenthesis depth; a closed group's courses count for its parent, so
    '(A or B) with a C' covers A and B. ', or S' right after a grade marks
    those courses as also accepting S. A grade with no course before it stays
    as text, so the line is marked partial rather than losing it.
    """
    out: list[list] = []
    pending: list[list[dict]] = [[]]  # ungraded course leaves, one list per depth
    last_graded: list[dict] = []
    for kind, value in tokens:
        if kind == "lp":
            pending.append([])
        elif kind == "rp" and len(pending) > 1:
            closed = pending.pop()
            pending[-1].extend(closed)
        elif kind == "course":
            pending[-1].append(value)
        elif kind == "grade":
            if pending[-1]:
                for leaf in pending[-1]:
                    leaf["min_grade"] = value
                last_graded, pending[-1] = pending[-1], []
            else:
                out.append(["text", f"grade of {value}"])
            continue
        elif kind == "or_s":
            for leaf in last_graded:
                leaf["or_s"] = True
            continue
        out.append([kind, value])
    return out


# --- pass 3: merge words into phrases ----------------------------------------------

def _merge_text(tokens: list[list]) -> list[list]:
    """Join runs of words into one phrase; drop phrases that are only filler."""
    out: list[list] = []
    for kind, value in tokens:
        if kind == "text" and out and out[-1][0] == "text":
            out[-1][1] += " " + value
        else:
            out.append([kind, value])
    return [t for t in out
            if not (t[0] == "text" and all(w.lower() in _FILLER for w in t[1].split()))]


# --- pass 4: resolve commas ----------------------------------------------------------

def _resolve_commas(tokens: list[list]) -> list[list]:
    """A comma means whatever operator comes next at the same depth:
    'A, B, or C' -> OR;  'A, B, and C' and 'A, B' -> AND.
    A comma directly before an operator (', or') is just punctuation."""
    out: list[list] = []
    for i, (kind, value) in enumerate(tokens):
        if kind != "comma":
            out.append([kind, value])
        elif not (i + 1 < len(tokens) and tokens[i + 1][0] in ("and", "or")):
            out.append([_next_operator(tokens, i + 1), None])
    return out


def _next_operator(tokens: list[list], start: int) -> str:
    depth = 0
    for kind, _ in tokens[start:]:
        if kind == "lp":
            depth += 1
        elif kind == "rp":
            if depth == 0:
                break
            depth -= 1
        elif depth == 0 and kind in ("and", "or"):
            return kind
    return "and"


# --- pass 5: parse ------------------------------------------------------------------

class _Parser:
    """Recursive descent over the token list:
        and_expr := or_expr ("and" or_expr)*
        or_expr  := sequence ("or" sequence)*
        sequence := primary+          (side by side with no operator = one phrase)
        primary  := "(" and_expr ")" | course | text
    OR binds tighter than AND because UF writes "A or B, and C" to mean
    (A or B) and C.
    """

    def __init__(self, tokens: list[list]) -> None:
        self.tokens = tokens
        self.pos = 0

    def peek(self) -> str | None:
        return self.tokens[self.pos][0] if self.pos < len(self.tokens) else None

    def take(self) -> list:
        token = self.tokens[self.pos]
        self.pos += 1
        return token

    def parse(self) -> dict | None:
        items = []
        while self.peek() is not None:
            items.append(self.and_expr())
            if self.peek() in ("rp", "or"):  # stray ')' or a dangling 'or': skip it
                self.take()
        return _group("and", items)

    def and_expr(self) -> dict | None:
        items = [self.or_expr()]
        while self.peek() == "and":
            self.take()
            items.append(self.or_expr())
        return _group("and", items)

    def or_expr(self) -> dict | None:
        items = [self.sequence()]
        while self.peek() == "or":
            self.take()
            items.append(self.sequence())
        return _group("or", items)

    def sequence(self) -> dict | None:
        items = []
        while self.peek() in ("lp", "course", "text"):
            items.append(self.primary())
        items = [n for n in items if n is not None]
        if len(items) <= 1:
            return items[0] if items else None
        # Operands side by side with no operator ("concurrent registration in
        # FOS 4222"): we cannot tell how they combine, so keep them as words.
        return {"type": "unparsed",
                "text": " ".join(_describe(n) for n in items),
                "mentions": _mentions({"type": "and", "items": items})}

    def primary(self) -> dict | None:
        kind, value = self.take()
        if kind == "lp":
            node = self.and_expr()
            if self.peek() == "rp":
                self.take()
            return node
        if kind == "course":
            return value
        return _classify(value)


def _group(kind: str, items: list) -> dict | None:
    items = [n for n in items if n is not None]
    if not items:
        return None
    return items[0] if len(items) == 1 else {"type": kind, "items": items}


# --- leaves -------------------------------------------------------------------------

_LEAF_PATTERNS = [
    ("program", re.compile(r"^(?P<code>[A-Z]{2,5}_[A-Z0-9]{2,10})(?:\s+(?:major|minor|students?))?$")),
    ("program_name", re.compile(
        r"^(?P<name>[A-Za-z][A-Za-z .&-]*?)\s+(?P<kind>major|minor)s?\b.*$", re.IGNORECASE)),
    ("standing", re.compile(
        r"^(?:minimum\s+)?(?P<level>freshman|sophomore|junior|senior)(?:\s+(?:standing|classification|status))?"
        r"(?P<higher>\s+or\s+(?:higher|above|better|greater))?$", re.IGNORECASE)),
    ("gpa", re.compile(
        r"^(?:(?P<scope>upper[\s-]division|overall|cumulative|uf|major)\s+)?(?:minimum\s+)?gpa\s+(?:of\s+)?"
        r"(?P<min>\d\.\d+)(?:\s+or\s+(?:higher|above|better|greater))?$", re.IGNORECASE)),
    ("credits", re.compile(
        r"^(?:(?:a\s+)?minimum\s+(?:of\s+)?|at\s+least\s+)?(?P<min>\d+)\s+(?:credits|credit\s+hours|hours)"
        r"(?:\s+(?:completed|earned))?(?:\s+or\s+more)?$", re.IGNORECASE)),
    ("equivalent", re.compile(r"^(?:the\s+)?equivalent(?:\s+courses?)?$", re.IGNORECASE)),
]
_PERMISSION_RE = re.compile(r"\b(?:permission|consent|approval)\b", re.IGNORECASE)
_PLACEMENT_RE = re.compile(r"\bplacement\b|\bscore\b|\bAP\b|\bIB\b|\btest\b|\bexam\b", re.IGNORECASE)


def _classify(text: str) -> dict:
    """Turn a phrase into a typed leaf, or an unparsed leaf if we don't know it."""
    text = text.strip(" ,")
    for kind, pattern in _LEAF_PATTERNS:
        m = pattern.match(text)
        if not m:
            continue
        if kind == "program":
            return {"type": "program", "code": m.group("code")}
        if kind == "program_name":
            return {"type": "program", "name": m.group("name").strip(), "kind": m.group("kind").lower()}
        if kind == "standing":
            return {"type": "standing", "level": m.group("level").lower(), "or_higher": bool(m.group("higher"))}
        if kind == "gpa":
            leaf = {"type": "gpa", "min": float(m.group("min"))}
            if m.group("scope"):
                leaf["scope"] = m.group("scope").lower().replace("-", " ")
            return leaf
        if kind == "credits":
            return {"type": "credits", "min": int(m.group("min"))}
        return {"type": "equivalent"}
    if _PERMISSION_RE.search(text) and len(text.split()) <= 6:
        low = text.lower()
        who = ("instructor" if "instructor" in low else
               "department" if "department" in low or "dept" in low else
               "coordinator" if "coordinator" in low or "advisor" in low else "other")
        return {"type": "permission", "who": who, "text": text}
    if _PLACEMENT_RE.search(text):
        return {"type": "placement", "text": text}
    return {"type": "unparsed", "text": text, "mentions": []}


# --- tree helpers ---------------------------------------------------------------------

def _simplify(node: dict) -> dict:
    """Flatten nested same-type groups: and(and(a, b), c) -> and(a, b, c)."""
    if node["type"] not in ("and", "or"):
        return node
    items = []
    for child in (_simplify(c) for c in node["items"]):
        if child["type"] == node["type"]:
            items.extend(child["items"])
        else:
            items.append(child)
    return {"type": node["type"], "items": items}


def leaves(node: dict):
    """Every non-group node in the tree, left to right."""
    if node["type"] in ("and", "or"):
        for child in node["items"]:
            yield from leaves(child)
    else:
        yield node


def _status(tree: dict) -> str:
    unparsed = [leaf["type"] == "unparsed" for leaf in leaves(tree)]
    if not any(unparsed):
        return "complete"
    return "unparsed" if all(unparsed) else "partial"


def _mentions(tree: dict) -> list[str]:
    found: list[str] = []
    for leaf in leaves(tree):
        if leaf["type"] == "course":
            found.append(leaf["course_id"])
        elif leaf["type"] == "unparsed":
            found.extend(leaf.get("mentions", []))
    return list(dict.fromkeys(found))


def _describe(node: dict) -> str:
    """Render a node back to readable text (merged phrases now; engine reasons later)."""
    t = node["type"]
    if t in ("and", "or"):
        return "(" + f" {t} ".join(_describe(c) for c in node["items"]) + ")"
    if t == "course":
        grade = f" (min {node['min_grade']}{' or S' if node.get('or_s') else ''})" if "min_grade" in node else ""
        return ids.id_to_code(node["course_id"]) + grade
    if t == "standing":
        return f"{node['level']} standing" + (" or higher" if node["or_higher"] else "")
    if t == "program":
        return node.get("code") or f"{node['name']} {node['kind']}"
    if t == "gpa":
        return f"{node.get('scope', '')} GPA {node['min']}".strip()
    if t == "credits":
        return f"{node['min']} credits"
    if t == "equivalent":
        return "equivalent"
    return node["text"]
