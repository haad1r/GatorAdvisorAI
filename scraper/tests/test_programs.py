"""Program parsing, QA and per-program overrides.

The page fixtures are real catalog pages (2026-2027), saved from the cache:
  sta_umn.html   Statistics minor: "Approved electives 6" over a bare table
  cve_bsce.html  Civil Engineering: model-plan placeholders + "Approved Electives" tab
  fch_ba.html    Chinese BA: concentration names over a "Concentration Courses" tab
  chy_bs.html    Chemistry BS hub: its only table is on the Learning Compact tab
  plb_umn.html   Plant Breeding minor: "Electives 9" subheader right after a chooser
  las_uct31.html Urban-Economic Geography cert: "Approved electives 6" over hour-less courses
  hll_ba01.html  Spanish BA: "Choose One: 6" over "A & B / OR / C & D"
  bot_bs01.html  Botany BS01: "Select one:" split by a bare OR; hour-less "Cells and Tissues"
  zly_bs.html    Zoology BS: "Select at least three ... 9-10" then "Additional ... 11"
  gly_bs03.html  Geology BS03: "...Core Coursework: 18 credits" subheader after a chooser
  agl_uct20.html Recreation cert: "Select three of the following groups" over labelled groups
  psy_bs03.html  Psychology BS03: "Select at least one course from each:" (a distribution)
  eco_ba.html    Economics BA: "Select a maximum of one:" (a cap)
  bot_bs02.html  Botany BS02: "OR" printed as a subheader between Option A and Option B
  art_uct04.html Music in Medicine cert: unlinked "MUN 1000/3000 Music ensemble" (a level)
"""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from scraper import config, fetch, programs, qa
from scraper.programs import ParsedProgram, ProgramRecord, RequirementGroupRow

FIXTURES = Path(__file__).parent / "fixtures" / "programs"
BASE = "https://catalog.ufl.edu/UGRD/colleges-schools"


def parse(name: str, url: str) -> ParsedProgram:
    return programs.parse_program_page((FIXTURES / name).read_text(encoding="utf-8"), url)


def by_key(parsed: ParsedProgram) -> dict[str, RequirementGroupRow]:
    return {g.group_key: g for g in parsed.groups}


# --- page tabs and option pools ------------------------------------------------

def test_learning_compact_tables_are_never_requirements():
    # Its only course table assesses learning outcomes; read as a requirement it
    # made the Chemistry hub look like a finished one-group program, so its two
    # real tracks were never fetched.
    parsed = parse("chy_bs.html", f"{BASE}/UGLAS/CHY_BS/")
    assert parsed.groups == []


def test_option_tab_pools_link_to_the_placeholders_that_name_them():
    parsed = parse("cve_bsce.html", f"{BASE}/UGENG/CVE_BSCE/")
    groups = by_key(parsed)
    technical = groups["technical-electives"]
    assert technical.rtype == "choose_credits" and technical.section == "major"
    assert technical.required_credits == 9  # 3 + 6 from the model plan's two rows
    assert "tte4201" in technical.eligible_course_ids
    assert groups["second-level-core-classes"].required_credits == 12
    plan = groups["plan-derived"]
    assert not plan.logic.get("placeholders")  # every elective row found its pool
    assert not any(g.section == "options" for g in parsed.groups)


def test_heading_does_not_cross_into_another_tab():
    # The first table on the electives tab has its own <h2>; the model plan's
    # "Semester 8" heading on the previous tab must never name it.
    parsed = parse("cve_bsce.html", f"{BASE}/UGENG/CVE_BSCE/")
    assert not any("semester" in g.name.lower() for g in parsed.groups if g.section != "geneed")


def test_bare_elective_table_becomes_the_reserved_rows_menu():
    parsed = parse("sta_umn.html", f"{BASE}/UGLAS/STA_UMN/")
    electives = [g for g in parsed.groups if g.logic.get("linked_from")]
    assert len(electives) == 1
    assert electives[0].required_credits == 6
    assert len(electives[0].eligible_course_ids) == 15
    # no required list asks for all 15 options any more
    assert all(g.required_credits <= 18 for g in parsed.groups if g.required_credits)


def test_concentration_names_become_options_of_one_chooser():
    parsed = parse("fch_ba.html", f"{BASE}/UGLAS/FCH_BA/")
    chooser = by_key(parsed)["critical-concentration-6-credits"]
    assert chooser.rtype == "choose_credits" and chooser.required_credits == 6
    assert "Film and Visual Culture" in chooser.logic["option_labels"]
    assert len(chooser.logic["options"]) == len(chooser.logic["option_labels"])
    assert all(chooser.logic["options"])


def test_rows_with_hours_under_a_chooser_are_parts_not_alternatives():
    # "Marine Sciences Major Electives: 15-16" over "Approved marine sciences
    # electives 12" + "Marine sciences core elective 3-4": two requirements.
    groups = by_key(parse("mar_bs.html", f"{BASE}/UGLAS/MAR_BS/"))
    assert groups["approved-marine-sciences-electives"].required_credits == 12
    assert groups["marine-sciences-core-elective"].required_credits == 3
    assert "options" not in groups["approved-marine-sciences-electives"].logic


def test_tables_named_by_a_select_one_row_become_its_options():
    parsed = parse("tpr_umn.html", f"{BASE}/UGART/TPR_UMN/")
    track = by_key(parsed)["select-one-track"]
    assert track.logic["option_labels"] == ["Costume Design Track", "Lighting Design Track", "Set Design Track"]
    assert sum(g.required_credits or 0 for g in parsed.groups if g.section == "major") <= 19


def test_summary_rows_that_restate_a_chooser_are_dropped():
    parsed = parse("com_umn.html", f"{BASE}/UGJRC/COM_UMN/")
    assert sum(g.required_credits or 0 for g in parsed.groups if g.section == "major") == 15


def test_a_subheader_with_its_own_hours_after_a_chooser_is_the_next_requirement():
    # "Plant breeding - select one: 3" then the subheader "Electives 9": the
    # electives used to vanish into the chooser as a placeholder alternative.
    groups = by_key(parse("plb_umn.html", f"{BASE}/UGAGL/PLB_UMN/"))
    breeding = groups["plant-breeding-select-one"]
    assert breeding.eligible_course_ids == ["agr4320", "hos4241c"]
    assert not breeding.logic.get("placeholders")
    # an elective-named header over hour-less courses is a pool, not "take all 13"
    electives = groups["electives"]
    assert electives.rtype == "choose_credits" and electives.required_credits == 9
    assert len(electives.eligible_course_ids) == 13


def test_a_plain_comment_row_inside_a_chooser_stays_an_alternative():
    # com_umn's "CJC study abroad course 3" is an ordinary row, not a subheader.
    parsed = parse("com_umn.html", f"{BASE}/UGJRC/COM_UMN/")
    assert any("CJC study abroad course" in p for g in parsed.groups
               for p in g.logic.get("placeholders", []))


# --- chooser instructions the text alone does not show ------------------------

@pytest.mark.parametrize("text, expected", [
    ("Select at least two:", {"n": 2, "credits": None}),
    ("Select a minimum of 3 credits beyond college requirement:", {"n": None, "credits": 3.0}),
    ("Choose One:", {"n": 1, "credits": None}),
    ("Select six:", {"n": 6, "credits": None}),
    ("Specialization; Select three:", {"n": 3, "credits": None}),
    ("Chinese Language (select one)", {"n": 1, "credits": None}),
    ("And, select one:", {"n": 1, "credits": None}),
    # free text, caps and distributions are not chooser instructions
    ("FYCS undergraduate course – select one course", None),
    ("Of the 18 credits of major electives, students may select up to 9 credits", None),
    ("Select a maximum of one:", None),
    ("Select at least one course from each:", None),
    ("Select at least one course from two of three groups:", None),
])
def test_select_instruction_wording(text, expected):
    assert programs._parse_select(text) == expected


def test_a_row_with_hours_over_hourless_courses_is_a_chooser():
    # "Approved electives 6" over five courses with no hours: they were all required.
    groups = by_key(parse("las_uct31.html", f"{BASE}/UGLAS/LAS_UCT31/"))
    assert groups["requirements"].eligible_course_ids == ["geo3502", "geo3602"]
    electives = groups["approved-electives"]
    assert electives.rtype == "choose_credits" and electives.required_credits == 6
    assert len(electives.eligible_course_ids) == 5


def test_a_bare_or_splits_a_chooser_into_whole_options():
    # "Choose One: 6" over "SPN 2240 & SPN 3300 / OR / SPN 2340 & SPN 3350":
    # one route or the other, never a mix, and SPN 3700 is required after it.
    groups = by_key(parse("hll_ba01.html", f"{BASE}/UGLAS/HLL_BA01/"))
    core = groups["hll-spanish-core-coursework-12-credits"]
    assert core.logic["options"] == [["spn2240", "spn3300"], ["spn2340", "spn3350"]]
    assert groups["hll-spanish-core-coursework-12-credits-2"].eligible_course_ids == ["spn3700"]
    # its electives header keeps its own rows rather than taking the chooser's courses
    assert groups["hll-spanish-major-electives-21-credits"].eligible_course_ids == []


def test_an_or_inside_select_one_and_hourless_subheaders_after_choosers():
    groups = by_key(parse("bot_bs01.html", f"{BASE}/UGLAS/BOT_BS/BOT_BS01/"))
    first = groups["required-foundation-courses"]
    assert first.logic["options"] == [["bot2010c", "bot2011c"], ["bsc2010", "bsc2010l", "bsc2011", "bsc2011l"]]
    assert groups["required-foundation-courses-2"].eligible_course_ids == ["chm2045", "chm2045l", "chm2046", "chm2046l"]
    # "Cells and Tissues" is the next requirement, not an alternative of the ecology chooser
    assert not groups["ecology-and-florida-biodiversity"].logic.get("placeholders")
    assert groups["cells-and-tissues"].eligible_course_ids == ["bot4935", "pcb3023", "bch4024"]
    assert "botanical-research-specialization-biodiversity-breadth-major-electives" in groups


def test_a_chooser_with_hourless_options_ends_at_the_next_row_with_hours():
    groups = by_key(parse("zly_bs.html", f"{BASE}/UGLAS/ZLY_BS/"))
    zoology = groups["zoology-or-zoology-related-major-elective-coursework-20-21-credits"]
    assert zoology.rtype == "choose_credits" and zoology.required_credits == 9
    assert zoology.required_course_count == 3
    rest = groups["zoology-or-zoology-related-major-elective-coursework-20-21-credits-2"]
    assert rest.required_credits == 11 and rest.eligible_course_ids == []


def test_a_subheader_with_credits_in_its_name_after_a_chooser_is_the_next_requirement():
    groups = by_key(parse("gly_bs03.html", f"{BASE}/UGLAS/GLY_BA_BS/GLY_BS03/"))
    assert not groups["historical-geology-course-select-one"].logic.get("placeholders")
    core = groups["general-geology-bs-major-core-coursework-18-credits"]
    assert core.rtype == "required_list" and core.required_credits == 18
    remaining = groups["select-remaining-coursework-from-these-approved-math-science-electives"]
    assert remaining.rtype == "choose_credits" and remaining.required_credits == 3


def test_subheaders_that_label_a_chooser_stay_its_alternatives():
    # "Select three of the following groups and take one course from each:" then
    # "Wildlife" / "Tourism" / ...: labels, not four requirements.
    groups = by_key(parse("agl_uct20.html", f"{BASE}/UGAGL/AGL_UCT20/"))
    chooser = groups["select-three-of-the-following-groups-and-take-one-course-from-each"]
    assert chooser.required_course_count == 3
    assert chooser.logic["placeholders"] == ["Wildlife", "Tourism", "Communication", "Community Development"]


def test_an_or_subheader_labels_nothing():
    # "Option A / OR / Option B": the "OR" subheader must not mark later
    # subheaders ("Chemistry", "Physics") as labels of a chooser.
    groups = by_key(parse("bot_bs02.html", f"{BASE}/UGLAS/BOT_BS/BOT_BS02/"))
    assert groups["chemistry"].eligible_course_ids == ["chm2045", "chm2045l", "chm2046", "chm2046l", "chm2200", "chm2200l"]
    assert groups["physics"].eligible_course_ids == ["phy2004", "phy2004l"]
    assert not groups["select-one"].logic.get("placeholders")


def test_an_unlinked_round_thousand_code_is_a_level_not_a_course():
    groups = by_key(parse("art_uct04.html", f"{BASE}/UGART/ART_UCT04/"))
    req = groups["requirements"]
    assert "mun1000" not in req.eligible_course_ids and "hum2592" in req.eligible_course_ids
    assert "MUN 1000/3000 Music ensemble 1" in req.logic["placeholders"]


def test_distribution_and_cap_rows_open_no_chooser():
    # "Select at least one course from each:" spreads over the four areas below it
    psy = by_key(parse("psy_bs03.html", f"{BASE}/UGLAS/PSY_BS/PSY_BS03/"))
    assert {"biological-bases-of-psychology", "developmental-psychology",
            "learning-and-cognition", "sociocultural-individual-differences-approaches"} <= set(psy)
    # "Select a maximum of one:" caps four non-ECO courses; they are not the
    # options of "Four economics elective courses 15-16" above it
    eco = by_key(parse("eco_ba.html", f"{BASE}/UGLAS/ECO_BA/"))
    assert eco["upper-level-major-electives"].rtype == "required_list"


@pytest.mark.parametrize("text, expected", [
    ("3000/4000-level History courses 12", (3, 4, 12.0)),
    ("1000 to 4000-level History courses 9", (1, 4, 9.0)),
    ("GLY courses (3000/4000 level) 6", (3, 4, 6.0)),
    ("4000-level Spanish courses 12", (4, 4, 12.0)),
    ("EEE or EEL-prefixed courses (3000 or 4000 level) 9", (3, 4, 9.0)),
    ("FRE, FRW, or FRT courses 9", (1, 4, 9.0)),
    ("3000-level or higher Political Science courses 18", (3, 9, 18.0)),
])
def test_subject_level_rows(text, expected):
    prefixes, lo, hi, credits, rules = programs._match_level_wildcard(text)
    assert (lo, hi, credits) == expected and prefixes and rules == []


def test_a_level_qualifier_becomes_a_count_rule_and_others_are_never_guessed():
    *_, rules = programs._match_level_wildcard(
        "POR, POW, or PRT courses (3000/4000 level; at least two must be 4000 level) 15")
    assert rules == [{"at_least": 2, "unit": "courses", "min_level": 4000,
                      "prefixes": ["por", "pow", "prt"], "text": "at least two must be 4000 level"}]
    assert programs._match_level_wildcard("ANT courses (3000/4000 level; excluding individual work) 9") is None
    assert programs._match_level_wildcard("Non-language Asia-related courses (3000/4000 level) 15") is None


def test_theme_ignores_filler_words_and_plurals():
    assert programs._theme("Approved Technical electives (6 credits)") == {"technical"}
    assert programs._theme("Technical Electives | Select 6") == {"technical"}
    assert programs._theme("Approved Electives") == frozenset()


def test_page_fingerprint_ignores_page_chrome_but_not_content():
    page = '<html><nav>{nav}</nav><div id="textcontainer"><p>{body}</p></div></html>'
    base = programs.page_fingerprint(page.format(nav="a", body="12 credits"))
    assert programs.page_fingerprint(page.format(nav="b", body="12 credits")) == base
    assert programs.page_fingerprint(page.format(nav="a", body="15 credits")) != base


# --- QA ----------------------------------------------------------------------

def program(*groups: RequirementGroupRow, kind: str = "minor") -> ParsedProgram:
    return ParsedProgram(program=ProgramRecord(id="uglas-x_umn", name="X", kind=kind,
                                               catalog_year="2026-2027"),
                         groups=list(groups), fingerprint="abc")


def required(key: str, ids: list[str], credits: float) -> RequirementGroupRow:
    return RequirementGroupRow(group_key=key, name=key, rtype="required_list",
                               logic={"slots": [[i] for i in ids]}, eligible_course_ids=ids,
                               required_credits=credits, required_course_count=len(ids),
                               sort_order=0, section="major", raw_html="")


def test_schedule_only_ids_resolve_without_costing_confidence():
    parsed = program(required("core", ["rtv3001", "mmc2604"], 6))
    absent = qa.evaluate(parsed, {"mmc2604"})
    resolved = qa.evaluate(parsed, {"mmc2604"}, schedule_only_ids={"rtv3001"})
    assert absent.confidence < 1.0
    assert resolved.confidence == 1.0
    assert any(i["advisory"] and "Schedule of Courses" in i["message"] for i in resolved.issues)


def test_option_pools_are_not_scored():
    pool = RequirementGroupRow(group_key="options-x", name="X", rtype="choose_credits",
                               logic={"from": ["zzz1000"], "credits": None, "option_pool": True},
                               eligible_course_ids=["zzz1000"], required_credits=None,
                               required_course_count=None, sort_order=1, section="options", raw_html="")
    result = qa.evaluate(program(required("core", ["mmc2604"], 3), pool), {"mmc2604"})
    assert result.confidence == 1.0 and not result.issues


def test_credit_total_matches_on_all_major_groups_when_the_total_table_is_partial():
    # The stated total sits under the first table, but later tables are required too.
    parsed = program(required("requirements", ["mmc2604"], 3), required("category-a", ["mmc3200"], 12))
    parsed.total_credits, parsed.total_credit_keys = 15, ["requirements"]
    assert not any("sum to" in i["message"] for i in qa.evaluate(parsed).issues)
    parsed.total_credits = 18
    assert any("sum to" in i["message"] for i in qa.evaluate(parsed).issues)


def test_a_take_all_list_too_small_for_its_courses_is_flagged_without_cost():
    menu = required("distribution", ["zzz3001", "zzz3002", "zzz3003", "zzz3004", "zzz3005"], 6)
    result = qa.evaluate(program(menu))
    flagged = [i for i in result.issues if "smaller than its courses" in i["message"]]
    assert flagged and flagged[0]["advisory"] and result.confidence == 1.0


def test_catalog_credits_decide_whether_a_take_all_list_is_too_small():
    # Three 1-credit ensembles for 3 credits are fine; a 4-credit "Mathematics"
    # list over a 4-credit and a 3-credit course is a chooser in disguise.
    hours = {"mun1001": 1.0, "mun1002": 1.0, "mun1003": 1.0, "mac1147": 4.0, "mac1140": 3.0}
    def flagged(group):
        result = qa.evaluate(program(group), course_credits=hours)
        return [i for i in result.issues if "smaller than its courses" in i["message"]]
    assert not flagged(required("ensembles", ["mun1001", "mun1002", "mun1003"], 3))
    assert flagged(required("mathematics", ["mac1147", "mac1140"], 4))


def test_more_credits_than_a_minor_can_hold_blocks_publishing():
    parsed = program(required("core", ["mmc2604"], 15), required("menu", ["mmc3200"], 40))
    result = qa.evaluate(parsed, {"mmc2604", "mmc3200"})
    assert any("add up to 55" in e["message"] for e in result.errors)
    assert qa.decide_status(result) == "needs_review"


# --- program overrides -----------------------------------------------------------

def override(**extra) -> dict:
    return {"reason": "checked by hand",
            "reviewed": {"date": "2026-10-12", "catalog_year": "2026-2027", "fingerprint": "abc"},
            "status": "published", **extra}


def test_override_needs_a_review_stamp():
    raw = override()
    del raw["reviewed"]
    with pytest.raises(ValueError, match="reviewed"):
        qa.apply_program_overrides(program(required("core", ["mmc2604"], 3)), raw)


def test_current_override_forces_its_status_and_records_its_reason():
    parsed, forced, stale = qa.apply_program_overrides(program(required("core", ["mmc2604"], 3)), override())
    assert (forced, stale) == ("published", None)
    assert parsed.override_reason == "checked by hand"


def test_stale_override_still_applies_but_forces_nothing():
    parsed = program(required("core", ["mmc2604"], 3), required("junk", ["mmc3200"], 3))
    parsed.fingerprint = "changed"
    parsed, forced, stale = qa.apply_program_overrides(parsed, override(exclude_groups=["junk"]))
    assert [g.group_key for g in parsed.groups] == ["core"]
    assert forced is None and "page content changed" in stale


def test_an_override_naming_a_missing_group_stops_the_run_unless_the_page_changed():
    raw = override(exclude_groups=["renamed-by-a-parser-change"])
    with pytest.raises(ValueError, match="renamed-by-a-parser-change"):
        qa.apply_program_overrides(program(required("core", ["mmc2604"], 3)), raw)
    parsed = program(required("core", ["mmc2604"], 3))
    parsed.fingerprint = "changed"  # UF edited the page: drift is expected
    _, forced, stale = qa.apply_program_overrides(parsed, raw)
    assert forced is None and stale


def test_a_forced_publish_cannot_override_errors():
    result = qa.evaluate(program(required("core", ["mmc2604"], 15), required("menu", ["mmc3200"], 40)),
                         {"mmc2604", "mmc3200"})
    assert qa.final_status(result, "published") == "needs_review"
    assert qa.final_status(qa.evaluate(program(required("core", ["mmc2604"], 3)), {"mmc2604"}),
                           "published") == "published"


def test_option_routes_count_as_parsed_slots():
    chooser = RequirementGroupRow(group_key="lang", name="Language", rtype="choose_credits",
                                  logic={"options": [["lat1120", "lat1101"], ["gre1120", "gre1121"]], "credits": 10},
                                  eligible_course_ids=["lat1120", "lat1101", "gre1120", "gre1121"],
                                  required_credits=10, required_course_count=None, sort_order=0,
                                  section="major", raw_html="")
    assert qa.evaluate(program(chooser)).confidence == 1.0


def test_override_course_ids_must_exist():
    raw = override(add_groups=[{"group_key": "extra", "name": "Extra",
                                "eligible_course_ids": ["mmc9999"], "logic": {"slots": [["mmc9999"]]}}])
    with pytest.raises(ValueError, match="mmc9999"):
        qa.apply_program_overrides(program(required("core", ["mmc2604"], 3)), raw, {"mmc2604"})
    # graduate-level ids live in a catalog we don't crawl, so they are allowed
    raw["add_groups"][0].update(eligible_course_ids=["mmc6930"], logic={"slots": [["mmc6930"]]})
    qa.apply_program_overrides(program(required("core", ["mmc2604"], 3)), raw, {"mmc2604"})


# --- fetcher -----------------------------------------------------------------------

def test_cooldown_serves_an_expired_cache_entry_instead_of_refusing(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    fetcher = fetch.Fetcher("programs")
    url = "https://catalog.ufl.edu/UGRD/x/"
    old = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
    fetcher._cache_path(url).write_text(json.dumps(
        {"url": url, "fetched_at": old, "body": "<html/>", "etag": None, "last_modified": None}),
        encoding="utf-8")
    (tmp_path / "programs" / "last_network_run.json").write_text(
        json.dumps({"last_network_run": datetime.now(timezone.utc).isoformat()}), encoding="utf-8")
    fetcher = fetch.Fetcher("programs")
    page = fetcher.get(url)
    assert page.body == "<html/>" and page.from_cache
    with pytest.raises(fetch.NetworkBlockedError):
        fetcher.get("https://catalog.ufl.edu/UGRD/never-fetched/")


def test_subject_level_expansion_keeps_placeholder_hours_aligned_and_keys_unique():
    host = RequirementGroupRow(
        group_key="electives", name="Electives", rtype="choose_credits",
        logic={"placeholders": ["GLY courses (3000/4000 level) 6", "Approved electives 3"],
               "placeholder_credits": [6, 3], "credits": 9},
        eligible_course_ids=[], required_credits=9, required_course_count=None,
        sort_order=0, section="major", raw_html="")
    clash = required("elective-gly-courses-3000-4000-level-6", ["gly2010"], 3)
    parsed = program(host, clash)
    new = programs.expand_subject_elective_groups(parsed, {"gly3200", "gly4400", "gly2010"}, 2)
    assert host.logic["placeholders"] == ["Approved electives 3"]
    assert host.logic["placeholder_credits"] == [3]
    assert (host.required_credits, host.logic["credits"]) == (3, 3)
    assert [g.group_key for g in new] == ["elective-gly-courses-3000-4000-level-6-2"]


def test_index_kind_is_known_while_parsing():
    parsed = programs.parse_program_page(
        "<html><h1>X</h1></html>", "https://catalog.ufl.edu/UGRD/colleges-schools/UGLAS/X_BA/", "minor")
    assert parsed.program.kind == "minor"


def test_an_override_may_not_patch_a_group_it_adds():
    raw = override(add_groups=[{"group_key": "extra", "name": "Extra"}],
                   patch_groups={"extra": {"name": "Renamed"}})
    with pytest.raises(ValueError, match="adds"):
        qa.apply_program_overrides(program(required("core", ["mmc2604"], 3)), raw)


def test_an_open_elective_slot_without_credits_is_reported_not_crashed():
    slot = RequirementGroupRow(group_key="open", name="Open", rtype="choose_credits",
                               logic={"open_electives": True}, eligible_course_ids=[],
                               required_credits=None, required_course_count=None,
                               sort_order=0, section="major", raw_html="")
    assert any("open elective slot" in i["message"] for i in qa.evaluate(program(slot), set()).issues)
