"""Program-parse validation, confidence scoring, and per-program overrides.

Never trust auto-parse alone: every parsed program gets a confidence score
and an issue list (stored in program_qa), and only programs that clear the
publish gate — or are forced by an override — reach status='published',
which is what the web app's RLS exposes.

program_overrides/<program_id>.json shape ("reason" and "reviewed" required,
all else optional):
{
  "reason":         "why a human changed this program, and what was checked",
  "reviewed":       { "date": "2026-10-12", "catalog_year": "2026-2027",
                      "fingerprint": "<programs.page_fingerprint of the page>" },
  "program":        { "name": "...", "kind": "minor", "degree": "..." },
  "status":         "published",              // force past the gate
  "exclude_groups": ["group-key", ...],
  "patch_groups":   { "<group-key>": { any RequirementGroupRow field } },
  "add_groups":     [ { full RequirementGroupRow fields } ],
  "exclusive_sets": { "<set-name>": ["group-key", ...] },
  "count_rules":    { "<group-key>": [ { "at_least"|"at_most": n,
                        "unit": "courses"|"credits", "min_level"?: 4000,
                        "prefixes"?: ["maa", ...], "text": "..." } ] },
  "exclude":        true                       // drop the program entirely
}
Like overrides.json for courses, a patch replaces only the fields it names.

`reviewed` (changed from UF Planner, whose overrides applied forever) stamps
the exact page a human checked. When the page's fingerprint or catalog year no
longer matches, the override is STALE: its corrections still apply (they are
usually still right, and the result is easier to re-review), but its forced
status is withdrawn and an error holds the program at needs_review until
someone re-checks the page and re-stamps it (`python -m scraper.run review
<id> --stamp`).

Course ids an override supplies (add_groups / patch_groups) are typed by hand,
so each must exist in the catalog, the Schedule of Courses, or be graduate-
level; an unknown id is an error, not the warning a parsed id would get.

`exclusive_sets` (s78) records UF's "a course may be counted toward only one
group": every group named in a set gets `logic.exclusive_set = <set-name>`,
MERGED into its logic rather than replacing it, so a set never has to restate a
group's whole logic the way a `patch_groups` entry would. It runs last, after
patches and additions, so it can name an added group. A key that names no group
is an error rather than a warning: a set that silently lost a member would
quietly let that course count twice again.

`count_rules` (s80) records a rule INSIDE one group that the group model cannot
express on its own: "at least one must be a Department of Mathematics course at
the 4000 level or above", "no more than 6 credits of ITT prefix courses". Each
rule is merged into the group's logic as `logic.count_rules`, the same merge
`exclusive_sets` uses, and carries the page's own sentence in `text`. A course
counts toward a rule when its prefix is in `prefixes` (if given) and its level
is at least `min_level` (if given). A key that names no group, or a rule with a
malformed shape, is an error: a rule nothing can count against is only a
sentence, which is exactly what these were before.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import re

from .programs import ParsedProgram, RequirementGroupRow

log = logging.getLogger("scraper.qa")

# Graduate-level course ids (5000-7999). UF undergrad programs legitimately
# require these (combined-degree tracks, 5xxx electives), but they live in
# the GRAD catalog the scraper doesn't crawl — absence is a warning, not an
# unresolved-id error, and (being known-external) they don't dent confidence.
GRAD_COURSE_ID_RE = re.compile(r"^[a-z]{3}[5-7]\d{3}[a-z]?$")

# A well-formed UF course id: 3-letter prefix + 4 digits + optional lab letter.
# Program pages routinely cite well-formed ids that have no standalone entry in
# our course table — cross-listed under another prefix, discontinued, or in a
# department the UGRD catalog doesn't publish a course page for (e.g. Sport
# Management/SPM). The program page is authoritative that the course is
# required, so an absent-but-well-formed id degrades confidence (via the
# resolution factor) rather than hard-blocking the whole program. Only
# genuinely malformed ids remain errors.
WELLFORMED_COURSE_ID_RE = re.compile(r"^[a-z]{3}\d{4}[a-z]?$")

# Publish gate: at or above this confidence with zero error-severity issues.
DEFAULT_PUBLISH_THRESHOLD = 0.85

# Groups synthesized from the model plan grid (no sc_courselist on the page)
# can never clear the gate on confidence alone — override-only publishing.
DERIVED_CONFIDENCE_CAP = 0.75

# The program parser's default name for a headerless requirement table. On a
# well-formed page every major table has a specific header ("Required Major
# Coursework", "Core"); a generic "Requirements" group appearing ALONGSIDE
# specifically-named major groups is the signature of a stray non-required
# table mis-parsed as required (the eco_ba "Recommended Coursework" bug).
# Newly skipped at the source, but this sweep flags any that slip through for
# review before the program is trusted.
GENERIC_GROUP_NAME_RE = re.compile(r"^\s*requirements\s*$", re.IGNORECASE)

ERROR = "error"
WARNING = "warning"


@dataclass
class QAResult:
    confidence: float = 1.0
    issues: list[dict] = field(default_factory=list)  # {severity, message, group_key}

    def add(self, severity: str, message: str, group_key: str = "",
            in_coverage: bool = False, advisory: bool = False) -> None:
        # in_coverage: this warning is already reflected in the coverage ratio
        # (one per placeholder slot), so the flat per-warning penalty would
        # double-count it.
        # advisory: a "have a human look" flag that says nothing about parse
        # QUALITY, so it must not move the score — it stays visible in the
        # issue list and in `report`, but never gates publishing.
        self.issues.append({"severity": severity, "message": message,
                            "group_key": group_key, "in_coverage": in_coverage,
                            "advisory": advisory})

    @property
    def errors(self) -> list[dict]:
        return [i for i in self.issues if i["severity"] == ERROR]


def evaluate(parsed: ParsedProgram, known_course_ids: set[str] | None = None,
             schedule_only_ids: set[str] | None = None,
             course_credits: dict[str, float] | None = None) -> QAResult:
    """Score one parsed program. known_course_ids comes from the courses
    table/CSV; pass None to skip id-resolution checks (offline parse tests).

    schedule_only_ids (changed from UF Planner): undergraduate courses the
    Schedule of Courses has offered but the catalog has no course page for
    (Telecommunication RTV, Sport Management SPM, ...). They count as resolved,
    with an advisory note so a reader knows their details come from data/soc/.
    UF Planner instead copied them into its courses.csv, which hid where they
    came from.

    course_credits: catalog id -> minimum credit hours, for the "required list
    smaller than its courses" advisory; None falls back to a rough heuristic."""
    qa = QAResult()
    schedule_only_ids = schedule_only_ids or set()
    if known_course_ids is not None:
        known_course_ids = known_course_ids | schedule_only_ids

    # Option pools (section "options": the courses an Approved Electives or
    # Concentration tab lists) are reference lists, not requirements, so they
    # neither count as parsed coverage nor get credit-checked.
    scored = [g for g in parsed.groups if g.section != "options"]
    if not scored:
        qa.add(ERROR, "no requirement groups parsed from the page")
        qa.confidence = 0.0
        return qa

    course_slots = 0
    placeholder_slots = 0
    unresolved: list[str] = []

    for g in scored:
        placeholders = g.logic.get("placeholders", [])
        placeholder_slots += len(placeholders)
        if g.rtype == "required_list":
            course_slots += sum(1 for s in g.logic.get("slots", []) if isinstance(s, list))
        else:
            # An option-bucket chooser ("Option A / Option B", concentrations)
            # carries its parsed routes in logic.options, not logic.from;
            # each route is a parsed slot (changed from UF Planner, which
            # scored these choosers as zero parsed courses).
            course_slots += len(g.logic.get("from") or g.logic.get("options") or [])
            if not g.eligible_course_ids and not placeholders:
                if g.logic.get("open_electives"):
                    # Credit-bearing chooser whose approved list lives off-table:
                    # a usable open elective slot, not a blocking parse failure.
                    qa.add(
                        WARNING,
                        f"open elective slot '{g.name}': {g.required_credits or 0:g} credits from an "
                        "approved list not enumerated in the table",
                        g.group_key,
                    )
                else:
                    qa.add(
                        ERROR,
                        f"choose-group '{g.name}' has no parseable options "
                        "(requirements likely live in prose outside the table) — needs an override",
                        g.group_key,
                    )
        for text in placeholders:
            qa.add(WARNING, f"unparsed requirement kept as placeholder: {text!r}",
                   g.group_key, in_coverage=True)

        if known_course_ids is not None:
            from_schedule = [c for c in g.eligible_course_ids if c in schedule_only_ids]
            if from_schedule:
                qa.add(WARNING, "course ids with no catalog page, resolved from the Schedule of "
                       f"Courses (data/soc/courses.csv): {', '.join(from_schedule)}",
                       g.group_key, advisory=True)
            missing = [c for c in g.eligible_course_ids if c not in known_course_ids]
            grad = [c for c in missing if GRAD_COURSE_ID_RE.match(c)]
            absent = [c for c in missing
                      if c not in grad and WELLFORMED_COURSE_ID_RE.match(c)]
            malformed = [c for c in missing if c not in grad and c not in absent]
            if grad:
                qa.add(WARNING, f"graduate-level ids outside the UGRD catalog: {', '.join(grad)}", g.group_key)
            if absent:
                # Well-formed but not in our course table: degrade confidence
                # (resolution factor) so mostly-phantom programs still fail the
                # gate, but don't hard-block an otherwise-complete program.
                unresolved.extend(absent)
                qa.add(WARNING, f"course ids referenced by the program but absent from "
                       f"the catalog (cross-listed/discontinued): {', '.join(absent)}", g.group_key)
            if malformed:
                unresolved.extend(malformed)
                qa.add(ERROR, f"malformed course ids: {', '.join(malformed)}", g.group_key)

    # Sweep for the "Recommended Coursework" mis-parse pattern: a generically-
    # named "Requirements" group sitting next to specifically-named major groups
    # is likely a non-required table parsed as required. ADVISORY only — it flags
    # a shape worth a human look, not a measured parse defect, and the 2026-07-24
    # sweep reviewed all 51 hits and found exactly one real bug (gpy_ba01, fixed).
    # Scoring it demoted 12 correctly-parsed published programs below the gate,
    # so it stays visible but never moves confidence.
    major_groups = [g for g in scored if g.section == "major"]

    # Changed from UF Planner: a "take all of these" list whose stated credits
    # cannot cover its courses (9 credits over 39 courses) is usually a chooser
    # whose "Select" instruction lives in prose. ADVISORY: some hits are fine
    # (0-credit labs, "& 2048L" slots), so it lists suspects for review
    # (run.py report, "required list smaller than its courses") without moving
    # confidence. With course_credits (the catalog's minimum hours) it asks the
    # real question instead: do the courses' own minimum hours, cheapest "or"
    # alternative per slot, exceed the list's credits? That clears 1-2 credit
    # music courses and "& lab" slots, and catches a 2-course chooser (psy_bs03
    # "Mathematics 4-5" over MAC 1147 / MAC 1140 & MAC 1114).
    for g in major_groups:
        slots = [s for s in g.logic.get("slots", []) if isinstance(s, list)]
        n_slots = len(slots)
        if (g.rtype != "required_list" or not g.required_credits
                or g.logic.get("derived_from") == "plangrid"):
            continue
        if course_credits is not None:
            known = [s for s in slots if all(c in course_credits for c in s)]
            suspect = (n_slots >= 2 and len(known) == n_slots
                       and sum(min(course_credits[c] for c in s) for s in slots) > g.required_credits + 1)
        else:
            suspect = n_slots >= 3 and g.required_credits < 2 * n_slots
        if suspect:
            qa.add(WARNING, f"required list smaller than its courses: {n_slots} courses for "
                   f"{g.required_credits:g} credits; may be a chooser read as 'take all'",
                   g.group_key, advisory=True)

    generic = [g for g in major_groups if GENERIC_GROUP_NAME_RE.match(g.name)]
    if generic and len(major_groups) > len(generic):
        for g in generic:
            qa.add(
                WARNING,
                f"generic '{g.name}' group alongside specifically-named major "
                "requirements — possible mis-parsed non-required block "
                "(e.g. 'Recommended Coursework'); review",
                g.group_key,
                advisory=True,
            )

    # Stated total vs the sum of group credits. Both sides are best-effort
    # (gen-ed credits often live outside the table), so mismatch only warns.
    # Only the listsum-bearing table's groups count: multi-table pages keep
    # elective options / recommended coursework in tables the total ignores.
    # Changed from UF Planner: a minor whose total sits under its first table
    # but whose later tables are required categories (sjp_umn, sst_umn) matches
    # on the sum of every major group instead, so either sum agreeing is enough.
    scoped = scored
    if parsed.total_credit_keys:
        scoped = [g for g in scored if g.group_key in parsed.total_credit_keys]
    group_credits = [g.required_credits for g in scoped if g.required_credits is not None]
    all_major = sum(g.required_credits or 0 for g in scored if g.section == "major")
    if parsed.total_credits and group_credits:
        diff = min(abs(sum(group_credits) - parsed.total_credits),
                   abs(all_major - parsed.total_credits))
        if diff > 1:
            qa.add(
                WARNING,
                f"group credits sum to {sum(group_credits):g} but the page states "
                f"{parsed.total_credits:g} total",
            )

    # Credit plausibility (changed from UF Planner, which silently deleted
    # oversized groups when building the web app, so its CSVs stayed wrong).
    # A program whose requirements add up to far more than the page's stated
    # total, or than a degree / minor can hold, has option lists parsed as
    # requirements (every specialization required at once, sample-schedule
    # tables, a subject-area menu). That is a wrong answer for a student, so
    # it blocks publishing rather than warning.
    plausible = _plausible_credits(parsed)
    required = sum(g.required_credits or 0 for g in scored
                   if g.section in ("major", "tracking", "college")
                   and g.logic.get("derived_from") != "plangrid")
    if required > plausible:
        qa.add(ERROR, f"requirements add up to {required:g} credits, more than this "
               f"{parsed.program.kind} can hold (~{plausible:g}): option lists were "
               "probably parsed as required; needs an override or a parser fix")

    if not parsed.plan and parsed.program.kind == "major":
        qa.add(WARNING, "no model semester plan (sc_plangrid) found")

    # Confidence: fraction of requirement rows machine-parsed, degraded by
    # unresolved ids and (mildly) by every warning NOT already reflected in
    # coverage. Placeholder warnings are 1:1 with placeholder slots, so the
    # coverage ratio already accounts for them — penalizing again would
    # double-count and needlessly sink otherwise fully-parsed programs.
    total_slots = course_slots + placeholder_slots
    coverage = course_slots / total_slots if total_slots else 0.0
    resolution = 1.0 - (len(unresolved) / course_slots) if course_slots else 0.0
    qa.confidence = round(coverage * resolution, 3)
    for issue in qa.issues:
        if (issue["severity"] == WARNING and not issue.get("in_coverage")
                and not issue.get("advisory")):
            qa.confidence = max(0.0, round(qa.confidence - 0.02, 3))

    derived = [g for g in scored if g.logic.get("derived_from") == "plangrid"]
    for g in derived:
        qa.add(
            WARNING,
            "requirements derived from the model plan grid (page has no "
            "sc_courselist) — review before publishing via override",
            g.group_key,
        )
    if derived:
        qa.confidence = min(qa.confidence, DERIVED_CONFIDENCE_CAP)

    return qa


# The most requirement credits a program of each kind can plausibly carry: a
# bachelor's degree is 120 credits (+10 slack for labs and 4-credit sequences);
# UF minors and certificates run 12-30. The page's own "Total Credits" is no
# ceiling: it totals only the FIRST table (2026-10-12: tying the check to it
# flagged 54 programs, most of them correct, e.g. every Hamilton BA).
MAX_PLAUSIBLE_CREDITS = {"major": 130.0, "minor": 45.0, "certificate": 45.0}


def _plausible_credits(parsed: ParsedProgram) -> float:
    return MAX_PLAUSIBLE_CREDITS.get(parsed.program.kind, 130.0)


def final_status(qa: QAResult, forced: str | None) -> str:
    """An override's status wins, except that it can never publish a program
    QA still finds errors in (changed from UF Planner, where "status":
    "published" bypassed everything). Accepting a program means accepting its
    warnings (placeholders, a plan-derived spine); an error means the data is
    wrong, and the override has to fix the data, not just the status."""
    if forced == "published" and qa.errors:
        qa.add(ERROR, "override forces status 'published' but errors remain; fix them in the override")
        return "needs_review"
    return forced or decide_status(qa)


def decide_status(qa: QAResult, threshold: float = DEFAULT_PUBLISH_THRESHOLD) -> str:
    if qa.errors or qa.confidence < threshold:
        return "needs_review"
    return "published"


# -- per-program overrides ---------------------------------------------------

GROUP_FIELDS = (
    "name", "rtype", "logic", "eligible_course_ids",
    "required_credits", "required_course_count", "sort_order", "section",
)
PROGRAM_FIELDS = ("name", "kind", "degree", "college_slug", "catalog_year")


def load_program_overrides(overrides_dir: Path, program_id: str) -> dict:
    path = overrides_dir / f"{program_id}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def override_staleness(parsed: ParsedProgram, overrides: dict) -> str | None:
    """Why this override no longer matches the page it was reviewed against,
    or None when it still does."""
    reviewed = overrides.get("reviewed") or {}
    if reviewed.get("catalog_year") != parsed.program.catalog_year:
        return (f"override was reviewed against the {reviewed.get('catalog_year')} catalog, "
                f"this page is {parsed.program.catalog_year}")
    if reviewed.get("fingerprint") != parsed.fingerprint:
        return (f"page content changed since the override was reviewed on {reviewed.get('date')} "
                f"(fingerprint {reviewed.get('fingerprint')} -> {parsed.fingerprint})")
    return None


def _referenced_groups(overrides: dict) -> set[str]:
    """Parsed group keys an override relies on (add_groups' own keys count as
    present: a set or rule may name a group the override adds)."""
    refs = set(overrides.get("exclude_groups", [])) | set(overrides.get("patch_groups", {}))
    refs |= set(overrides.get("count_rules") or {})
    for keys in (overrides.get("exclusive_sets") or {}).values():
        refs |= set(keys)
    return refs - {g["group_key"] for g in overrides.get("add_groups", [])}


def _override_course_ids(overrides: dict) -> set[str]:
    """Every course id an override supplies by hand."""
    found: set[str] = set()

    def walk(value: object) -> None:
        if isinstance(value, str):
            if WELLFORMED_COURSE_ID_RE.match(value) or GRAD_COURSE_ID_RE.match(value):
                found.add(value)
        elif isinstance(value, list):
            for v in value:
                walk(v)
        elif isinstance(value, dict):
            for k, v in value.items():
                if k not in ("placeholders", "note", "text"):  # prose, not ids
                    walk(v)

    for raw in overrides.get("add_groups", []):
        walk(raw.get("eligible_course_ids", []))
        walk(raw.get("logic", {}))
    for patch in overrides.get("patch_groups", {}).values():
        walk(patch.get("eligible_course_ids", []))
        walk(patch.get("logic", {}))
    return found


def apply_program_overrides(parsed: ParsedProgram, overrides: dict,
                            known_course_ids: set[str] | None = None,
                            ) -> tuple[ParsedProgram | None, str | None, str | None]:
    """Merge one program's override file. Returns (program, forced_status,
    stale_reason); a None program means the override excludes it entirely.
    A stale override still merges, but forces no status (see `reviewed`)."""
    if not overrides:
        return parsed, None, None
    pid = parsed.program.id
    if not str(overrides.get("reason", "")).strip():
        raise ValueError(f"{pid}: program override needs a non-empty \"reason\"")
    reviewed = overrides.get("reviewed")
    if not isinstance(reviewed, dict) or not all(reviewed.get(k) for k in ("date", "catalog_year", "fingerprint")):
        raise ValueError(f"{pid}: program override needs \"reviewed\": {{date, catalog_year, fingerprint}}")
    if known_course_ids is not None:
        unknown = sorted(c for c in _override_course_ids(overrides)
                         if c not in known_course_ids and not GRAD_COURSE_ID_RE.match(c))
        if unknown:
            raise ValueError(f"{pid}: override names course ids found in neither the catalog "
                             f"nor the Schedule of Courses: {unknown}")
    parsed.override_reason = str(overrides["reason"]).strip()
    stale = override_staleness(parsed, overrides)
    if stale:
        log.warning("%s: STALE override: %s", pid, stale)
    if overrides.get("exclude"):
        if stale:
            log.warning("%s: keeping the program despite its exclude override, which is stale", pid)
        else:
            log.info("excluding %s via override", pid)
            return None, None, None

    # Every group the override names must exist. On an unchanged page a
    # missing key means OUR parse changed under the override (a renamed or
    # vanished group), which must stop the run rather than quietly unhook the
    # correction (changed from UF Planner, where an exclude_groups or
    # patch_groups key that no longer matched was silently ignored). On a
    # changed page the override is stale anyway: drift is expected, the
    # missing parts are skipped and the stale error holds the program.
    missing = sorted(_referenced_groups(overrides) - {g.group_key for g in parsed.groups})
    if missing and not stale:
        raise ValueError(f"{pid}: override names groups this parse does not have: {missing} "
                         "(the parser changed under it; update the override)")

    for field_name in PROGRAM_FIELDS:
        if field_name in overrides.get("program", {}):
            setattr(parsed.program, field_name, overrides["program"][field_name])

    # Patches run before add_groups, so a patch aimed at an added group would
    # silently do nothing: write those fields into the added group instead.
    clash = {g["group_key"] for g in overrides.get("add_groups", [])} & set(overrides.get("patch_groups", {}))
    if clash:
        raise ValueError(f"{pid}: patch_groups names groups this override adds: {sorted(clash)}; "
                         "put those fields in add_groups")

    excluded = set(overrides.get("exclude_groups", []))
    if excluded:
        parsed.groups = [g for g in parsed.groups if g.group_key not in excluded]

    patches = overrides.get("patch_groups", {})
    for g in parsed.groups:
        patch = patches.get(g.group_key)
        if not patch:
            continue
        for field_name in GROUP_FIELDS:
            if field_name in patch:
                setattr(g, field_name, patch[field_name])
        log.info("%s: patched group %s via override", parsed.program.id, g.group_key)

    for raw in overrides.get("add_groups", []):
        parsed.groups.append(
            RequirementGroupRow(
                group_key=raw["group_key"],
                name=raw["name"],
                rtype=raw.get("rtype", "required_list"),
                logic=raw.get("logic", {}),
                eligible_course_ids=list(raw.get("eligible_course_ids", [])),
                required_credits=raw.get("required_credits"),
                required_course_count=raw.get("required_course_count"),
                sort_order=raw.get("sort_order", len(parsed.groups)),
                section=raw.get("section", "major"),
                raw_html="",
            )
        )
        log.info("%s: added group %s via override", parsed.program.id, raw["group_key"])

    by_key = {g.group_key: g for g in parsed.groups}
    for set_name, keys in (overrides.get("exclusive_sets") or {}).items():
        keys = [k for k in keys if k in by_key]  # only a stale override can miss one
        for k in keys:
            by_key[k].logic = {**(by_key[k].logic or {}), "exclusive_set": set_name}
        log.info("%s: exclusive set %s over %d groups via override",
                 parsed.program.id, set_name, len(keys))

    for key, rules in (overrides.get("count_rules") or {}).items():
        if key not in by_key:
            continue  # only a stale override can miss one
        for rule in rules:
            _validate_count_rule(parsed.program.id, key, rule)
        by_key[key].logic = {**(by_key[key].logic or {}), "count_rules": rules}
        log.info("%s: %d count rule(s) on %s via override", parsed.program.id, len(rules), key)

    return parsed, None if stale else overrides.get("status"), stale


def _validate_count_rule(program_id: str, key: str, rule: dict) -> None:
    """Refuse a count rule the web app could not count against."""
    where = f"{program_id}: count_rules[{key!r}]"
    if rule.get("unit") not in ("courses", "credits"):
        raise ValueError(f"{where}: unit must be 'courses' or 'credits', got {rule.get('unit')!r}")
    bounds = [b for b in ("at_least", "at_most") if b in rule]
    if not bounds or not all(isinstance(rule[b], (int, float)) and rule[b] >= 0 for b in bounds):
        raise ValueError(f"{where}: needs a non-negative at_least and/or at_most")
    level = rule.get("min_level")
    if level is not None and (not isinstance(level, int) or level % 1000 or not 1000 <= level <= 9000):
        raise ValueError(f"{where}: min_level must be a whole thousand, got {level!r}")
    prefixes = rule.get("prefixes")
    if prefixes is not None and (
        not isinstance(prefixes, list) or not all(isinstance(p, str) and p.isalpha() and p.islower() for p in prefixes)
    ):
        raise ValueError(f"{where}: prefixes must be lowercase course prefixes, got {prefixes!r}")
    if level is None and prefixes is None:
        raise ValueError(f"{where}: a rule with neither min_level nor prefixes counts every course")
    if not isinstance(rule.get("text"), str) or not rule["text"].strip():
        raise ValueError(f"{where}: text must carry the page's own sentence")
