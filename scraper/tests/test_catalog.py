from scraper import catalog

# A trimmed copy of a real department page: one course block, same markup UF uses
# (including the non-breaking space between prefix and number).
PAGE = """
<html><body>
<div id="header">2026-2027 Catalog</div>
<div class="courseblock courseblocktoggle">
  <p class="courseblocktitle noindent"><strong>EVS&#160;1010 First Year Environmental Science
    <span class="credits">1-3 Credits</span></strong></p>
  <p class="courseblockextra noindent"><strong>Grading Scheme:</strong> S/U</p>
  <p class="courseblockdesc noindent">Onboarding course for first year students.</p>
  <p class="courseblockextra noindent"><strong>Prerequisite:</strong> EVS_BA or EVS_BS.</p>
  <p class="courseblockextra noindent"><strong>Attributes:</strong> General Education - Biological Science,
    Quest 1, Satisfies 2000 Words of Writing Requirement, Artificial Intelligence</p>
</div>
</body></html>
"""


def tree(text):
    return catalog.parse_requisite(text).tree


def course(cid, grade=None, or_s=False):
    leaf = {"type": "course", "course_id": cid}
    if grade:
        leaf["min_grade"] = grade
    if or_s:
        leaf["or_s"] = True
    return leaf


def test_department_page_fields():
    page = catalog.parse_department_page(PAGE, "environmental_science")
    assert page.catalog_year == "2026-2027"
    (c,) = page.courses
    assert (c.id, c.code, c.name) == ("evs1010", "EVS 1010", "First Year Environmental Science")
    assert (c.credits_min, c.credits_max) == (1.0, 3.0)
    assert c.grading == "su"
    assert c.gen_ed == ["biological"] and c.quest == ["quest1"]
    assert c.writing_words == 2000
    assert c.other_attributes == ["Artificial Intelligence"]
    assert c.prereq.tree == {"type": "or", "items": [{"type": "program", "code": "EVS_BA"},
                                                     {"type": "program", "code": "EVS_BS"}]}


def test_grade_covers_every_course_in_its_group():
    assert tree("( BSC 2005 or BSC 2010 with minimum grades of C-) and CHM 2045") == {
        "type": "and", "items": [
            {"type": "or", "items": [course("bsc2005", "C-"), course("bsc2010", "C-")]},
            course("chm2045"),
        ]}


def test_grade_applies_only_to_courses_before_it():
    assert tree("MAN 3025 with a minimum grade of C and MAR 3023") == {
        "type": "and", "items": [course("man3025", "C"), course("mar3023")]}


def test_or_s_is_part_of_the_grade_not_a_separate_condition():
    assert tree("ITA 1130 with minimum grade of C, or S, or the equivalent") == {
        "type": "or", "items": [course("ita1130", "C", or_s=True), {"type": "equivalent"}]}


def test_commas_take_the_operator_that_follows():
    assert tree("MAC 2311, MAC 2312, or MAC 2313")["type"] == "or"
    assert tree("MAC 2311, MAC 2312, and MAC 2313")["type"] == "and"


def test_non_course_conditions_become_typed_leaves():
    assert tree("junior standing, upper division GPA of 3.75 or higher") == {
        "type": "and", "items": [
            {"type": "standing", "level": "junior", "or_higher": False},
            {"type": "gpa", "min": 3.75, "scope": "upper division"},
        ]}


def test_unrecognized_text_is_kept_and_marked():
    r = catalog.parse_requisite("MCB 2000L ; concurrent registration in FOS 4222 .")
    assert r.status == "partial"
    assert r.mentions == ["mcb2000l", "fos4222"]  # still visible to the dependency graph


def test_credits_within_subjects_or_from_a_list_are_one_leaf():
    # ~200 prerequisites were unparsed: the "or"s and commas split them apart.
    assert tree("6 credits of ENC or CRW or AML or ENG or ENL.") == {
        "type": "credits", "min": 6, "prefixes": ["enc", "crw", "aml", "eng", "enl"]}
    assert tree("\u200b6 credits of an AFH, AMH, ASH, EUH, LAH, or WOH course.") == {
        "type": "credits", "min": 6, "prefixes": ["afh", "amh", "ash", "euh", "lah", "woh"]}
    assert tree("Six credits of GER credit at the 3000-level.") == {
        "type": "credits", "min": 6, "prefixes": ["ger"], "min_level": 3000}
    # a subject in words is kept as written, never mapped to prefixes
    assert tree("6 credits of history.") == {"type": "credits", "min": 6, "subject": "history"}
    r = catalog.parse_requisite("(6 credits from AFS 2002 or HUM 2420 or AFH 2000 ) or (junior standing).")
    assert r.status == "complete" and r.mentions == ["afs2002", "hum2420", "afh2000"]
    assert r.tree["items"][0] == {"type": "credits", "min": 6, "from": ["afs2002", "hum2420", "afh2000"]}


def test_lowercase_words_are_never_course_codes():
    r = catalog.parse_requisite("3 credits at the 3000 level or above")
    assert r.mentions == []
    assert r.status == "unparsed"
