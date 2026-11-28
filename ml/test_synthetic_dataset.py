import unittest
from datetime import datetime, timezone

from synthetic_dataset import prepare, split_user


CUTOFF = datetime(2026, 1, 15, tzinfo=timezone.utc)


def pair(user, impression_at, feedback_at=None):
    return [
        {"event_id": "i", "kind": "impression", "user_id": user, "course_id": "SYN1000",
         "at": impression_at, "position": 1, "scoring_version": "scoring_v2"},
        {"event_id": "f", "kind": "like", "impression_id": "i", "user_id": user,
         "course_id": "SYN1000", "at": feedback_at or impression_at},
    ]


class SyntheticDatasetTests(unittest.TestCase):
    def setUp(self):
        users = [f"synthetic-{i}" for i in range(100)]
        self.train = next(user for user in users if split_user(user) == "train")
        self.test = next(user for user in users if split_user(user) == "test")

    def test_user_and_time_holdout(self):
        before, after = "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"
        self.assertEqual(prepare(pair(self.train, before), CUTOFF)[0]["partition"], "train")
        self.assertEqual(prepare(pair(self.test, after), CUTOFF)[0]["partition"], "test")
        self.assertEqual(prepare(pair(self.train, before, after), CUTOFF), [])
        self.assertEqual(prepare(pair(self.test, before), CUTOFF), [])
        self.assertEqual(prepare(pair(self.train, after), CUTOFF), [])

    def test_unexposed_or_conflicting_feedback_rejected(self):
        events = pair(self.train, "2026-01-01T00:00:00Z")
        with self.assertRaises(ValueError):
            prepare([events[1]], CUTOFF)
        with self.assertRaises(ValueError):
            prepare(events + [{**events[1], "kind": "dislike"}], CUTOFF)
        with self.assertRaises(ValueError):
            prepare(events + [{**events[1], "event_id": "f2", "kind": "dislike"}], CUTOFF)

    def test_exact_event_retries_do_not_duplicate_training_rows(self):
        events = pair(self.train, "2026-01-01T00:00:00Z")
        expected = prepare(events, CUTOFF)
        self.assertEqual(len(expected), 1)
        self.assertEqual(prepare(events + [dict(events[0]), dict(events[1])], CUTOFF), expected)

    def test_unlabeled_impressions_are_not_negative_examples(self):
        self.assertEqual(prepare(pair(self.train, "2026-01-01T00:00:00Z")[:1], CUTOFF), [])

    def test_feedback_must_match_identity_course_and_time(self):
        events = pair(self.train, "2026-01-01T00:00:00Z")
        for field, value in [("user_id", "another"), ("course_id", "SYN2000"), ("at", "2025-01-01T00:00:00Z")]:
            altered = [events[0], {**events[1], field: value}]
            with self.assertRaises(ValueError):
                prepare(altered, CUTOFF)

    def test_features_are_taken_only_from_the_impression_snapshot(self):
        events = pair(self.train, "2026-01-01T00:00:00Z")
        events[0]["features"] = {"interest_overlap": 0.8, "fills_requirement": 1, "level_match": 0}
        events[0]["request_id"] = "synthetic-request"
        events[1]["features"] = {"interest_overlap": 0, "fills_requirement": 0, "level_match": 1}
        events[1]["request_id"] = "forged-feedback-request"
        row = prepare(events, CUTOFF)[0]
        self.assertEqual((row["interest_overlap"], row["fills_requirement"], row["level_match"]), (0.8, 1, 0))
        self.assertEqual(row["request_id"], "synthetic-request")

    def test_bad_feature_snapshots_fail_closed(self):
        for features in [
            {"interest_overlap": float("nan"), "fills_requirement": 1, "level_match": 0},
            {"interest_overlap": 1.1, "fills_requirement": 1, "level_match": 0},
            {"interest_overlap": 0.5, "fills_requirement": True, "level_match": 0},
            {"interest_overlap": 0.5, "fills_requirement": 1, "level_match": 0, "label": 1},
        ]:
            events = pair(self.train, "2026-01-01T00:00:00Z")
            events[0]["features"] = features
            with self.assertRaises(ValueError):
                prepare(events, CUTOFF)


if __name__ == "__main__":
    unittest.main()
