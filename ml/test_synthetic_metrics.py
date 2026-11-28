import math
import unittest

from synthetic_metrics import ranking_metrics


class RankingMetricTests(unittest.TestCase):
    def test_hand_calculated_rankings(self):
        rows = [{"course_id": "A", "score": 0.8, "label": 0},
                {"course_id": "B", "score": 0.7, "label": 1}]
        self.assertEqual(ranking_metrics(rows, 1), {"ndcg": 0.0, "hit_rate": 0, "positive_count": 1})
        self.assertAlmostEqual(ranking_metrics(rows, 2)["ndcg"], 1 / math.log2(3))
        self.assertEqual(ranking_metrics(rows, 2)["hit_rate"], 1)

    def test_ties_are_stable_and_no_positive_is_not_a_quality_score(self):
        rows = [{"course_id": "B", "score": 1, "label": 0}, {"course_id": "A", "score": 1, "label": 1}]
        self.assertEqual(ranking_metrics(rows, 1)["ndcg"], 1)
        self.assertIsNone(ranking_metrics([{**rows[0], "label": 0}], 1)["ndcg"])

    def test_rejects_unlabeled_duplicate_or_invalid_input(self):
        valid = {"course_id": "A", "score": 0.5, "label": 1}
        for rows in [[], [valid, valid], [{**valid, "label": None}], [{**valid, "score": float("nan")}]]:
            with self.assertRaises(ValueError):
                ranking_metrics(rows, 1)
        with self.assertRaises(ValueError):
            ranking_metrics([valid], 0)


if __name__ == "__main__":
    unittest.main()
