"""Train a demonstration model on generated data only; never a serving model.

This tests pipeline mechanics, not ranking quality. It reads no event export and
does not serialize a model. The feature and label definitions are provisional.
"""
import json
import random
import sys
from pathlib import Path

import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

# Embedded Python runs in isolated mode and does not add the script directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from synthetic_dataset import CUTOFF, DATASET_VERSION, FEATURES, prepare, split_user

MODEL_VERSION = "synthetic_logistic_v1"
FEATURES = list(FEATURES)
SEED = 42


def synthetic_rows():
    rng = random.Random(SEED)
    events = []
    for index in range(200):
        user = f"synthetic-training-user-{index}"
        partition = split_user(user)
        # Synthetic events are placed on the relevant side of the cutoff.
        at = "2026-01-20T12:00:00Z" if partition == "test" else "2026-01-10T12:00:00Z"
        for course in range(4):
            interest = round(rng.random(), 3)
            requirement = rng.randrange(2)
            level = rng.randrange(2)
            label = int(interest + 0.3 * requirement + 0.2 * level + rng.uniform(-0.4, 0.4) > 0.8)
            course_id = f"synthetic-course-{course}"
            impression_id = f"impression-{index}-{course}"
            events.append({"event_id": impression_id, "kind": "impression", "user_id": user,
                           "course_id": course_id, "request_id": f"synthetic-request-{index}", "at": at, "position": course + 1,
                           "scoring_version": "scoring_v2", "features": {"interest_overlap": interest,
                           "fills_requirement": requirement, "level_match": level}})
            events.append({"event_id": f"feedback-{index}-{course}", "kind": "like" if label else "dislike",
                           "impression_id": impression_id, "user_id": user, "course_id": course_id, "at": at})
    return pd.DataFrame(prepare(events, CUTOFF))


def train_synthetic():
    rows = synthetic_rows()
    train = rows[rows["partition"] == "train"]
    test = rows[rows["partition"] == "test"]
    if set(train["user_id"]) & set(test["user_id"]):
        raise ValueError("user leakage across partitions")
    if train.empty or test.empty or train["label"].nunique() != 2:
        raise ValueError("synthetic training data must have both labels and a holdout")
    model = make_pipeline(StandardScaler(), LogisticRegression(random_state=SEED, max_iter=500))
    if rows[FEATURES].isna().any().any():
        raise ValueError("missing synthetic feature snapshot")
    model.fit(train[FEATURES], train["label"])
    predictions = model.predict_proba(test[FEATURES])[:, 1]
    return model, rows, predictions


def main():
    _, rows, predictions = train_synthetic()
    print(json.dumps({"data": "synthetic_only", "dataset_version": DATASET_VERSION,
                      "model_version": MODEL_VERSION, "seed": SEED, "features": FEATURES,
                      "training_rows": int((rows["partition"] == "train").sum()),
                      "held_out_rows": len(predictions), "purpose": "pipeline_smoke_test_only"}))


if __name__ == "__main__":
    main()
