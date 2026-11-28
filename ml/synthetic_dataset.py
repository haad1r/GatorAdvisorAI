"""Synthetic-only preparation prototype for issue #11, not a production export.

Run from the repository root: python ml/synthetic_dataset.py
No external data is read and no student data or output files are written.
"""

from datetime import datetime, timezone
import hashlib
import json
import math

DATASET_VERSION = "synthetic_dataset_v2"
CUTOFF = datetime(2026, 1, 15, tzinfo=timezone.utc)
FEATURES = ("interest_overlap", "fills_requirement", "level_match")


def validate_features(value):
    """Validate the provisional feature snapshot captured at impression time."""
    if not isinstance(value, dict) or set(value) != set(FEATURES):
        raise ValueError("invalid feature fields")
    interest = value["interest_overlap"]
    if isinstance(interest, bool) or not isinstance(interest, (int, float)) or not math.isfinite(interest) or not 0 <= interest <= 1:
        raise ValueError("interest overlap must be finite and between 0 and 1")
    for name in ("fills_requirement", "level_match"):
        if type(value[name]) is not int or value[name] not in (0, 1):
            raise ValueError(f"{name} must be 0 or 1")
    return dict(value)


def split_user(user_id: str) -> str:
    """Stable user holdout; IDs in this prototype are synthetic only."""
    bucket = int.from_bytes(hashlib.sha256(user_id.encode("utf-8")).digest()[:8], "big") % 5
    return "test" if bucket == 0 else "train"


def prepare(events: list[dict], cutoff: datetime) -> list[dict]:
    """Pair explicit feedback to its exposure without leaking across the cutoff.

    This provisional schema is synthetic, not TEAM-01's event export contract.
    Duplicate IDs, orphan feedback and conflicting labels are rejected rather
    than silently used as training data. Selections and missing feedback are not
    treated as labels; this does not correct exposure bias.
    """
    if cutoff.tzinfo is None or cutoff.utcoffset() is None:
        raise ValueError("cutoff must be timezone-aware")
    ids: set[str] = set()
    impressions: dict[str, dict] = {}
    feedback: list[dict] = []
    for event in events:
        if event["event_id"] in ids:
            raise ValueError("duplicate event ID")
        ids.add(event["event_id"])
        timestamp = datetime.fromisoformat(event["at"].replace("Z", "+00:00"))
        if timestamp.tzinfo is None or timestamp.utcoffset() is None:
            raise ValueError("event timestamp must be timezone-aware")
        if event["kind"] == "impression":
            features = validate_features(event["features"]) if "features" in event else None
            impressions[event["event_id"]] = {**event, "timestamp": timestamp, "validated_features": features}
        elif event["kind"] in ("like", "dislike", "not_interested"):
            feedback.append({**event, "timestamp": timestamp})
        else:
            raise ValueError("unsupported event kind")
    labels: dict[str, dict] = {}
    for event in feedback:
        impression = impressions.get(event["impression_id"])
        if impression is None or event["user_id"] != impression["user_id"] or event["course_id"] != impression["course_id"]:
            raise ValueError("feedback must match an impression and its user/course")
        if event["timestamp"] < impression["timestamp"]:
            raise ValueError("feedback predates its impression")
        if event["impression_id"] in labels:
            raise ValueError("multiple labels for an impression require an agreed policy")
        labels[event["impression_id"]] = event
    rows = []
    for impression_id, feedback_event in labels.items():
        impression = impressions[impression_id]
        split = split_user(impression["user_id"])
        # Train only before cutoff; test only held-out users after cutoff.
        if split == "train" and feedback_event["timestamp"] < cutoff:
            partition = "train"
        elif split == "test" and impression["timestamp"] >= cutoff:
            partition = "test"
        else:
            continue
        row = {"user_id": impression["user_id"], "course_id": impression["course_id"],
                     "position": impression["position"], "scoring_version": impression["scoring_version"],
                     "label": 1 if feedback_event["kind"] == "like" else 0, "partition": partition}
        if impression["validated_features"] is not None:
            row.update(impression["validated_features"])
        rows.append(row)
    return sorted(rows, key=lambda row: (row["partition"], row["user_id"], row["course_id"]))


def main() -> None:
    # Synthetic examples are deliberately generated in memory.
    events = []
    for i in range(30):
        user = f"synthetic-user-{i}"
        after = split_user(user) == "test"
        at = "2026-01-20T12:00:00Z" if after else "2026-01-10T12:00:00Z"
        impression = {"event_id": f"imp-{i}", "kind": "impression", "user_id": user,
                      "course_id": "SYN1000", "at": at, "position": 1, "scoring_version": "scoring_v2"}
        events.extend([impression, {"event_id": f"feedback-{i}", "kind": "like" if i % 2 else "dislike",
                                    "impression_id": impression["event_id"], "user_id": user,
                                    "course_id": "SYN1000", "at": at}])
    rows = prepare(events, CUTOFF)
    print(json.dumps({"dataset_version": DATASET_VERSION, "data": "synthetic", "cutoff": CUTOFF.isoformat(),
                      "train_rows": sum(row["partition"] == "train" for row in rows),
                      "test_rows": sum(row["partition"] == "test" for row in rows)}))


if __name__ == "__main__":
    main()
