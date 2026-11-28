import unittest

import numpy as np

from synthetic_training import FEATURES, synthetic_rows, train_synthetic
from synthetic_metrics import grouped_ranking_metrics


class SyntheticTrainingTests(unittest.TestCase):
    def test_split_is_user_disjoint_and_features_exclude_labels(self):
        rows = synthetic_rows()
        train = rows[rows.partition == "train"]
        test = rows[rows.partition == "test"]
        self.assertFalse(set(train.user_id) & set(test.user_id))
        self.assertNotIn("label", FEATURES)
        self.assertEqual(set(rows.label), {0, 1})
        self.assertEqual(len(rows), 800)
        self.assertTrue(rows[FEATURES].notna().all().all())

    def test_training_is_reproducible_and_predictions_are_finite(self):
        _, _, first = train_synthetic()
        _, _, second = train_synthetic()
        np.testing.assert_allclose(first, second)
        self.assertTrue(np.all(np.isfinite(first)))
        self.assertTrue(np.all((first >= 0) & (first <= 1)))

    def test_held_out_predictions_can_be_grouped_by_synthetic_request(self):
        _, rows, predictions = train_synthetic()
        held_out = rows[rows.partition == "test"].to_dict("records")
        for row, prediction in zip(held_out, predictions, strict=True):
            row["score"] = float(prediction)
        result = grouped_ranking_metrics(held_out, 2)
        self.assertEqual(result["request_count"], rows[rows.partition == "test"]["request_id"].nunique())
        self.assertGreater(result["evaluated_count"], 0)


if __name__ == "__main__":
    unittest.main()
