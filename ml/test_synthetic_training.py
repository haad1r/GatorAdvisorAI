import unittest

import numpy as np

from synthetic_training import FEATURES, synthetic_rows, train_synthetic


class SyntheticTrainingTests(unittest.TestCase):
    def test_split_is_user_disjoint_and_features_exclude_labels(self):
        rows = synthetic_rows()
        train = rows[rows.partition == "train"]
        test = rows[rows.partition == "test"]
        self.assertFalse(set(train.user_id) & set(test.user_id))
        self.assertNotIn("label", FEATURES)
        self.assertEqual(set(rows.label), {0, 1})

    def test_training_is_reproducible_and_predictions_are_finite(self):
        _, _, first = train_synthetic()
        _, _, second = train_synthetic()
        np.testing.assert_allclose(first, second)
        self.assertTrue(np.all(np.isfinite(first)))
        self.assertTrue(np.all((first >= 0) & (first <= 1)))


if __name__ == "__main__":
    unittest.main()
