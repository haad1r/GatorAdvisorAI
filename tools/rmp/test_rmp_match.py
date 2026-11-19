"""Matching tests. Synthetic names only; no network."""

import unittest

from rmp_import import Professor, match_one, normalize


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


if __name__ == "__main__":
    unittest.main()
