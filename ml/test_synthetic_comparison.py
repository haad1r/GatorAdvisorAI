import unittest

from synthetic_comparison import synthetic_comparison


class SyntheticComparisonTests(unittest.TestCase):
    def test_comparison_is_reproducible_and_labeled_synthetic(self):
        first = synthetic_comparison()
        second = synthetic_comparison()
        self.assertEqual(first, second)
        self.assertEqual(first["data"], "synthetic_only")
        self.assertEqual(first["purpose"], "mechanics_check_not_quality_evidence")
        self.assertEqual(first["scoring_version"], "scoring_v2")
        baseline, candidate = first["metrics"]["baseline"], first["metrics"]["candidate"]
        self.assertEqual(baseline["request_count"], candidate["request_count"])
        self.assertGreater(baseline["evaluated_count"], 0)
        self.assertLessEqual(len(first["synthetic_disagreement_examples"]), 3)
        for example in first["synthetic_disagreement_examples"]:
            self.assertTrue(example["request_id"].startswith("synthetic-request-"))


if __name__ == "__main__":
    unittest.main()
