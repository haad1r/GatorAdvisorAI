"""Matching tests. Synthetic names only; no network."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import rmp_import
from rmp_import import Professor, match_one, normalize, same_department


def prof(legacy_id, first, last, department="Computer Science", ratings=10):
    return Professor(legacy_id, first, last, department, ratings, {"legacy_id": str(legacy_id)})


PROFS = [
    prof(1, "Ana", "Martin-Ryals", "Agricultural & Biological Engineering"),
    prof(2, "Jordan", "Example"),
    prof(3, "Sam", "Sample", "Mathematics"),
    prof(4, "Sam", "Sample", "Physics"),
    prof(5, "Riley", "Twin", "History"),
    prof(6, "Riley", "Twin", "Music"),
    prof(7, "José", "Núñez", "Chemistry"),
    prof(8, "Pat", "Lee", "English"),
    prof(9, "Alex", "Rubenstein", "Management"),
    prof(10, "Ashleigh", "White", "Advertising"),
    prof(11, "Jonathan", "Martin", "Geology"),
    prof(12, "Agnes", "Leslie", "History"),
    prof(13, "Stephen", "Flory", "Agronomy"),
    prof(14, "Dana", "Dupe", "Hospitality", ratings=0),
    prof(15, "Dana", "Dupe", "Hospitality", ratings=7),
]

DEPTS = {"Computer and Information Science and Engineering"}


class Normalize(unittest.TestCase):
    def test_accents_case_and_hyphens(self):
        self.assertEqual(normalize("José  MARTÍN-Ryals"), "jose martin ryals")


class MatchOne(unittest.TestCase):
    def test_exact(self):
        method, p, _ = match_one("Jordan Example", DEPTS, PROFS)
        self.assertEqual((method, p.legacy_id), ("exact", 2))

    def test_all_caps_and_hyphenated(self):
        method, p, _ = match_one("ANA MARTIN-RYALS", DEPTS, PROFS)
        self.assertEqual((method, p.legacy_id), ("exact", 1))

    def test_accents_in_rmp_only(self):
        method, p, _ = match_one("Jose Nunez", DEPTS, PROFS)
        self.assertEqual((method, p.legacy_id), ("exact", 7))

    def test_middle_name_ignored(self):
        method, p, _ = match_one("Jordan Q Example", DEPTS, PROFS)
        self.assertEqual((method, p.legacy_id), ("first_last", 2))

    def test_nickname_prefix(self):
        method, p, _ = match_one("Jon Martin", DEPTS, PROFS)
        self.assertEqual((method, p.legacy_id), ("nickname", 11))
        method, p, _ = match_one("Patricia Lee", DEPTS, PROFS)
        self.assertEqual((method, p.legacy_id), ("nickname", 8))

    def test_one_letter_typo(self):
        method, p, _ = match_one("Agness Leslie", DEPTS, PROFS)
        self.assertEqual((method, p.legacy_id), ("nickname", 12))

    def test_doubled_letter_matches_in_any_department(self):
        profs = PROFS + [prof(70, "Randall", "Switt", "Engineering")]
        method, p, _ = match_one("Randal Switt", {"History"}, profs)
        self.assertEqual((method, p.legacy_id), ("nickname", 70))

    def test_other_one_letter_difference_is_a_different_person(self):
        profs = PROFS + [prof(71, "Jianping", "Wang", "Agronomy"), prof(72, "Andre", "Rossi", "Physics"),
                         prof(73, "Keiji", "Iwamoto", "Languages")]
        for name, dept in (("Jinping Wang", "Advertising"), ("Jinping Wang", "Agronomy"),
                           ("Andrea Rossi", "Physics"), ("Kenji Iwamoto", "Languages")):
            self.assertEqual(match_one(name, {dept}, profs)[:2], ("none", None), f"{name} in {dept}")

    def test_bare_initial_is_not_enough(self):
        self.assertEqual(match_one("S Flory", DEPTS, PROFS)[:2], ("none", None))

    def test_prefix_that_isnt_a_nickname_is_not_enough(self):
        profs = PROFS + [prof(20, "Jingjing", "Shi"), prof(21, "Ronald", "Behringer"), prof(22, "Jie", "Xu")]
        for name in ("Jin Shi", "Donald Behringer", "Jin Xu"):
            self.assertEqual(match_one(name, DEPTS, profs)[:2], ("none", None), name)

    def test_rare_name_listed_twice_in_other_departments(self):
        profs = PROFS + [prof(30, "Megan", "Mocko", "Statistics", ratings=397), prof(31, "Megan", "Mocko", "Business", ratings=30)]
        method, p, _ = match_one("Megan Mocko", {"Biology"}, profs)
        self.assertEqual((method, p.legacy_id), ("exact+duplicate", 30))

    def test_common_name_in_other_departments_stays_ambiguous(self):
        profs = PROFS + [prof(40 + i, "Chris", "Smith", d) for i, d in enumerate(["History", "Writing"])] + [prof(50 + i, "Al", "Smith") for i in range(3)]
        self.assertEqual(match_one("Chris Smith", {"Physics"}, profs)[:2], ("ambiguous", None))

    def test_same_first_letter_is_not_enough(self):
        self.assertEqual(match_one("Alan Rubenstein", DEPTS, PROFS)[:2], ("none", None))

    def test_half_of_hyphenated_last_name_is_not_enough(self):
        self.assertEqual(match_one("Abby Owens-White", DEPTS, PROFS)[:2], ("none", None))

    def test_rmp_duplicates_pick_most_ratings(self):
        method, p, _ = match_one("Dana Dupe", {"Tourism"}, PROFS)
        self.assertEqual((method, p.legacy_id), ("exact+duplicate", 15))

    def test_same_name_split_by_department(self):
        method, p, _ = match_one("Sam Sample", {"Physics"}, PROFS)
        self.assertEqual((method, p.legacy_id), ("exact+dept", 4))

    def test_no_match(self):
        self.assertEqual(match_one("Nobody Here", DEPTS, PROFS)[:2], ("none", None))

    def test_compound_surname_needs_the_department(self):
        profs = PROFS + [prof(60, "Angel", "Gonzalez", "Economics")]
        self.assertEqual(match_one("Angel Checa Gonzalez", {"Medicine: Community Health"}, profs)[:2], ("none", None))
        method, p, _ = match_one("Angel Checa Gonzalez", {"Economics"}, profs)
        self.assertEqual((method, p.legacy_id), ("first_last", 60))

    def test_hyphenated_first_name_is_not_a_different_given_name(self):
        profs = PROFS + [prof(61, "Ji Hoon", "Lee", "Journalism"), prof(62, "Su Ar", "Lee", "Languages")]
        self.assertEqual(match_one("Ji-Hyun Lee", {"Biostatistics"}, profs)[:2], ("none", None))
        self.assertEqual(match_one("Su Hyun Lee", {"Languages"}, profs)[:2], ("none", None))

    def test_rmp_two_word_first_name_matches_when_present(self):
        profs = PROFS + [prof(63, "Kyung Sun", "Rhee", "Marketing")]
        method, p, _ = match_one("Kyung Sun Rhee", {"Statistics"}, profs)
        self.assertEqual((method, p.legacy_id), ("exact", 63))

    def test_rmp_middle_name(self):
        profs = PROFS + [prof(66, "Adam B.", "Munson", "Management"), prof(67, "Clifford Russell", "Bowers", "Chemistry")]
        method, p, _ = match_one("Adam Munson", {"Physics"}, profs)
        self.assertEqual((method, p.legacy_id), ("first_last", 66))
        self.assertEqual(match_one("Clifford Bowers", {"Physics"}, profs)[:2], ("none", None))
        method, p, _ = match_one("Clifford Bowers", {"Chemistry"}, profs)
        self.assertEqual((method, p.legacy_id), ("first_last", 67))

    def test_parenthesized_notes_are_dropped(self):
        self.assertEqual(normalize("Joslyn Ahlgren (she/her)"), "joslyn ahlgren")
        profs = PROFS + [prof(64, "Joslyn", "Ahlgren", "Biology"), prof(65, "Chengguo", "Xing", "Pharmacy")]
        method, p, _ = match_one("Joslyn Ahlgren (she/her)", {"Biology"}, profs)
        self.assertEqual((method, p.legacy_id), ("exact", 64))
        method, p, _ = match_one("Chengguo (CX) Xing", {"Pharmacy"}, profs)
        self.assertEqual((method, p.legacy_id), ("exact", 65))

    def test_single_word_name_is_not_matched(self):
        self.assertEqual(match_one("Staff", DEPTS, PROFS)[:2], ("none", None))



class SameDepartment(unittest.TestCase):
    def test_broad_rmp_label_fits_a_longer_uf_name(self):
        self.assertTrue(same_department("Engineering", {"Chemical Engineering"}))
        self.assertTrue(same_department("Biology", {"Microbiology and Cell Science"}))
        self.assertTrue(same_department("Soil & Water Sciences", {"Soil, Water, and Ecosystems Sciences"}))

    def test_generic_or_partial_words_do_not_fit(self):
        self.assertFalse(same_department("Science", {"Political Science"}))
        self.assertFalse(same_department("Art", {"Earth Sciences"}))
        self.assertFalse(same_department("Not Specified", {"Business Admin General"}))
        self.assertFalse(same_department("", {"History"}))


class Numbers(unittest.TestCase):
    def test_no_data_is_blank_but_zero_percent_is_kept(self):
        self.assertEqual(rmp_import._number(-1, zero_is_data=True), "")
        self.assertEqual(rmp_import._number(0, zero_is_data=True), "0")
        self.assertEqual(rmp_import._number(0), "")
        self.assertEqual(rmp_import._number(4.5), "4.5")


def page(nodes, result_count, has_next=False):
    edges = [{"node": {"legacyId": n, "firstName": "A", "lastName": f"P{n}", "department": "History",
                       "avgRating": 4, "avgDifficulty": 3, "wouldTakeAgainPercent": 80, "numRatings": 5,
                       "school": {"legacyId": rmp_import.UF_LEGACY_ID}}} for n in nodes]
    return {"resultCount": result_count, "edges": edges, "pageInfo": {"hasNextPage": has_next, "endCursor": "c"}}


class FetchKeepsTheLastGoodSnapshot(unittest.TestCase):
    def run_fetch(self, pages):
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(rmp_import, "OUT", Path(tmp)), \
                mock.patch.object(rmp_import, "_post", side_effect=pages), \
                mock.patch.object(rmp_import.time, "sleep"):
            (Path(tmp) / "professors.csv").write_text("old snapshot\n")
            try:
                rmp_import.fetch(force=True)
                exited = False
            except SystemExit:
                exited = True
            return exited, (Path(tmp) / "professors.csv").read_text(), (Path(tmp) / "manifest.json").exists()

    def test_missing_result_count_writes_nothing(self):
        self.assertEqual(self.run_fetch([page([], None)]), (True, "old snapshot\n", False))
        self.assertEqual(self.run_fetch([page([], 0)]), (True, "old snapshot\n", False))

    def test_repeated_profiles_do_not_count_toward_the_total(self):
        pages = [page([1, 2, 3, 4, 5], 10, has_next=True), page([1, 2, 3, 4, 5], 10)]
        self.assertEqual(self.run_fetch(pages), (True, "old snapshot\n", False))

    def test_complete_fetch_replaces_the_snapshot(self):
        exited, text, manifest = self.run_fetch([page(range(1, 11), 10)])
        self.assertFalse(exited)
        self.assertTrue(manifest)
        self.assertEqual(len(text.strip().splitlines()), 11)


if __name__ == "__main__":
    unittest.main()
