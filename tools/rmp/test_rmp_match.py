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
    prof(6, "Riley", "Twin", "History"),
    prof(7, "José", "Núñez", "Chemistry"),
    prof(8, "Pat", "Lee", "English"),
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

    def test_nickname_falls_back_to_initial(self):
        method, p, _ = match_one("Patricia Lee", DEPTS, PROFS)
        self.assertEqual((method, p.legacy_id), ("initial", 8))

    def test_same_name_split_by_department(self):
        method, p, _ = match_one("Sam Sample", {"Physics"}, PROFS)
        self.assertEqual((method, p.legacy_id), ("exact+dept", 4))

    def test_same_name_same_department_is_ambiguous(self):
        method, p, cands = match_one("Riley Twin", {"History"}, PROFS)
        self.assertEqual((method, p, len(cands)), ("ambiguous", None, 2))

    def test_no_match(self):
        self.assertEqual(match_one("Nobody Here", DEPTS, PROFS)[:2], ("none", None))

    def test_single_word_name_is_not_matched(self):
        self.assertEqual(match_one("Staff", DEPTS, PROFS)[:2], ("none", None))


if __name__ == "__main__":
    unittest.main()
