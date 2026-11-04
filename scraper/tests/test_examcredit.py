from scraper import examcredit

# A trimmed AP table in UF's markup: heading, note row, a footnoted exam name,
# a Gen Ed column, and the footnote list that defines the writing words.
PAGE = """
<html><body>
<div>2026-2027 Catalog</div>
<h3>AP Exam Credit</h3>
<table>
  <tr><th>AP Exam</th><th>Score 3</th><th>Score 4</th><th>Score 5</th><th>Gen Ed Credit</th></tr>
  <tr><td></td><td>3 Credits/Exam unless otherwise noted</td><td>6 Credits/Exam</td><td>6 Credits/Exam</td><td></td></tr>
  <tr><td>Calculus AB</td><td>MAC 2311 (4 credits)</td><td>MAC 2311 (4 credits)</td><td>MAC 2311 (4 credits)</td>
      <td>State Core M</td></tr>
  <tr><td>English Language<sup>2</sup></td><td>ENC 1101</td><td>ENC 1101 and ENC 1102</td>
      <td>ENC 1101 and ENC 1102</td><td>ENC 1101, 1102 = C</td></tr>
  <tr><td>Art History</td><td>ARH L000</td><td>ARH 2000</td><td>ARH 2000</td><td>ARH 2000 = H and N</td></tr>
</table>
<dl class="sc_footnotes"><dt><sup>2</sup></dt><dd>Writing Requirement (6000 words)</dd></dl>
</body></html>
"""


def awards():
    return {a.id: a for a in examcredit.parse_exam_credit_page(PAGE).awards}


def test_identical_score_bands_collapse_into_one_range():
    calc = awards()["ap-calculus-ab-3-5"]
    assert (calc.course_ids, calc.credits, calc.credits_source, calc.gen_ed) == (
        ["mac2311"], 4, "explicit", ["mathematics"])


def test_note_row_credits_and_footnote_writing_words():
    eng = awards()["ap-english-language-4-5"]
    assert (eng.course_ids, eng.credits, eng.credits_source) == (["enc1101", "enc1102"], 6, "table_note")
    assert eng.writing_words == 6000
    assert eng.gen_ed == ["composition"]  # "1102" inherited the ENC prefix


def test_elective_placeholder_carries_credit_but_no_course_or_gen_ed():
    art3 = awards()["ap-art-history-3-3"]
    assert (art3.course_ids, art3.credits, art3.gen_ed, art3.award_text) == ([], 3, [], "ARH L000")
    assert awards()["ap-art-history-4-5"].gen_ed == ["humanities", "international"]


def test_catalog_year_is_read_from_the_page():
    assert examcredit.parse_exam_credit_page(PAGE).catalog_year == "2026-2027"


# UEXCEL states no credits anywhere: every award starts as the family default.
UEXCEL_PAGE = """
<html><body>
<div>2026-2027 Catalog</div>
<h3>UEXCEL Exam Credit</h3>
<table>
  <tr><th>UEXCEL Exam</th><th>Passing score C</th></tr>
  <tr><td>Calculus</td><td>MAC 2311</td></tr>
  <tr><td>Chemistry</td><td>CHM 2045, CHM 2045L</td></tr>
  <tr><td>Retired</td><td>ZZZ 1000</td></tr>
  <tr><td>Art</td><td>ART L000</td></tr>
</table>
</body></html>
"""


def test_assumed_awards_take_named_courses_catalog_credits():
    parsed = examcredit.parse_exam_credit_page(UEXCEL_PAGE).awards
    assert {a.credits_source for a in parsed} == {"assumed"}
    changed = examcredit.apply_course_credits(
        parsed, {"mac2311": 4.0, "chm2045": 3.0, "chm2045l": 1.0})
    got = {a.exam: (a.credits, a.credits_source) for a in parsed}
    assert got == {
        "Calculus": (4, "assumed_course"),
        "Chemistry": (4, "assumed_course"),   # lecture + lab summed
        "Retired": (3, "assumed"),            # course not in the catalog: default kept
        "Art": (3, "assumed"),                # elective credit names no course
    }
    assert changed == 2


def test_course_credits_never_override_a_stated_number():
    parsed = examcredit.parse_exam_credit_page(PAGE).awards
    before = [(a.credits, a.credits_source) for a in parsed]
    assert examcredit.apply_course_credits(parsed, {"enc1101": 9.0, "mac2311": 9.0}) == 0
    assert [(a.credits, a.credits_source) for a in parsed] == before
