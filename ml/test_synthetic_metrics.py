import math
import unittest

from synthetic_metrics import compare_synthetic_rankings, grouped_ranking_metrics, ranking_metrics


class RankingMetricTests(unittest.TestCase):
    def test_hand_calculated_rankings(self):
        rows = [{"course_id": "A", "score": 0.8, "label": 0},
                {"course_id": "B", "score": 0.7, "label": 1}]
        self.assertEqual(ranking_metrics(rows, 1), {"ndcg": 0.0, "hit_rate": 0, "reciprocal_rank": 0, "positive_count": 1})
        self.assertAlmostEqual(ranking_metrics(rows, 2)["ndcg"], 1 / math.log2(3))
        self.assertEqual(ranking_metrics(rows, 2)["hit_rate"], 1)
        self.assertEqual(ranking_metrics(rows, 2)["reciprocal_rank"], 0.5)

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

    def test_groups_distinct_requests_and_excludes_no_positive_groups(self):
        rows = [
            {"request_id": "r1", "user_id": "u1", "course_id": "A", "score": 0.9, "label": 1},
            {"request_id": "r2", "user_id": "u1", "course_id": "A", "score": 0.9, "label": 0},
            {"request_id": "r3", "user_id": "u2", "course_id": "A", "score": 0.9, "label": 0},
            {"request_id": "r3", "user_id": "u2", "course_id": "B", "score": 0.8, "label": 1},
        ]
        result = grouped_ranking_metrics(rows, 1)
        self.assertEqual(result, {"request_count": 3, "evaluated_count": 2, "no_positive_count": 1,
                                  "mean_ndcg": 0.5, "mean_hit_rate": 0.5, "mean_reciprocal_rank": 0.5})
        self.assertEqual(grouped_ranking_metrics(list(reversed(rows)), 1), result)

    def test_rejects_missing_request_or_reused_id_across_users(self):
        row = {"request_id": "r1", "user_id": "u1", "course_id": "A", "score": 0.9, "label": 1}
        with self.assertRaises(ValueError):
            grouped_ranking_metrics([{**row, "request_id": ""}], 1)
        with self.assertRaises(ValueError):
            grouped_ranking_metrics([row, {**row, "user_id": "u2", "course_id": "B"}], 1)

    def test_paired_comparison_uses_identical_requests_and_labels(self):
        baseline = [
            {"request_id": "r1", "user_id": "u1", "course_id": "A", "score": 0.9, "label": 0},
            {"request_id": "r1", "user_id": "u1", "course_id": "B", "score": 0.8, "label": 1},
        ]
        candidate = [{**baseline[0], "score": 0.1}, {**baseline[1], "score": 0.9}]
        result = compare_synthetic_rankings(baseline, candidate, 1)
        self.assertEqual(result["baseline"]["mean_hit_rate"], 0)
        self.assertEqual(result["candidate"]["mean_hit_rate"], 1)
        for altered in [candidate[:1], [{**candidate[0], "label": 1}, candidate[1]],
                        [{**candidate[0], "user_id": "u2"}, {**candidate[1], "user_id": "u2"}]]:
            with self.assertRaises(ValueError):
                compare_synthetic_rankings(baseline, altered, 1)


if __name__ == "__main__":
    unittest.main()
