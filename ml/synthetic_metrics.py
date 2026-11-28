"""Ranking-metric mechanics for synthetic fixtures, not a model evaluation report."""
import math


def ranking_metrics(rows: list[dict], k: int) -> dict:
    """Evaluate one synthetic request with explicit binary labels.

    No-positive requests report null metrics; unlabeled items and duplicate
    course IDs are rejected. This does not correct exposure or selection bias.
    """
    if type(k) is not int or k < 1:
        raise ValueError("k must be a positive integer")
    if not rows:
        raise ValueError("at least one labeled result is required")
    seen = set()
    for row in rows:
        code, score, label = row["course_id"], row["score"], row["label"]
        if not isinstance(code, str) or not code or code in seen:
            raise ValueError("course IDs must be nonempty and unique")
        if isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score):
            raise ValueError("score must be finite")
        if type(label) is not int or label not in (0, 1):
            raise ValueError("labels must be explicit binary integers")
        seen.add(code)
    positives = sum(row["label"] for row in rows)
    if not positives:
        return {"ndcg": None, "hit_rate": None, "positive_count": 0}
    ordered = sorted(rows, key=lambda row: (-row["score"], row["course_id"]))[:k]
    dcg = sum(row["label"] / math.log2(index + 2) for index, row in enumerate(ordered))
    ideal = sum(1 / math.log2(index + 2) for index in range(min(k, positives)))
    return {"ndcg": dcg / ideal, "hit_rate": int(any(row["label"] for row in ordered)), "positive_count": positives}
