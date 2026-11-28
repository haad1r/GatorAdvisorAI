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
        return {"ndcg": None, "hit_rate": None, "reciprocal_rank": None, "positive_count": 0}
    ordered = sorted(rows, key=lambda row: (-row["score"], row["course_id"]))[:k]
    dcg = sum(row["label"] / math.log2(index + 2) for index, row in enumerate(ordered))
    ideal = sum(1 / math.log2(index + 2) for index in range(min(k, positives)))
    first_positive = next((index + 1 for index, row in enumerate(ordered) if row["label"]), None)
    return {"ndcg": dcg / ideal, "hit_rate": int(first_positive is not None),
            "reciprocal_rank": 1 / first_positive if first_positive else 0, "positive_count": positives}


def grouped_ranking_metrics(rows: list[dict], k: int) -> dict:
    """Aggregate by request; omit no-positive groups and report their count.

    For synthetic mechanics only. Do not merge requests by user or treat this
    aggregation as an exposure-bias correction or a real-data evaluation.
    """
    if type(k) is not int or k < 1 or not rows:
        raise ValueError("a positive k and nonempty rows are required")
    groups: dict[str, list[dict]] = {}
    for row in rows:
        request_id = row.get("request_id")
        if not isinstance(request_id, str) or not request_id.strip():
            raise ValueError("request ID must be a nonempty string")
        user_id = row.get("user_id")
        if not isinstance(user_id, str) or not user_id.strip():
            raise ValueError("user ID must be a nonempty string")
        if request_id in groups and groups[request_id][0]["user_id"] != user_id:
            raise ValueError("request ID cannot be shared by different users")
        groups.setdefault(request_id, []).append(row)
    values = [ranking_metrics(groups[request_id], k) for request_id in sorted(groups)]
    evaluated = [value for value in values if value["ndcg"] is not None]
    count = len(evaluated)
    return {
        "request_count": len(groups), "evaluated_count": count, "no_positive_count": len(groups) - count,
        "mean_ndcg": sum(value["ndcg"] for value in evaluated) / count if count else None,
        "mean_hit_rate": sum(value["hit_rate"] for value in evaluated) / count if count else None,
        "mean_reciprocal_rank": sum(value["reciprocal_rank"] for value in evaluated) / count if count else None,
    }


def compare_synthetic_rankings(baseline: list[dict], candidate: list[dict], k: int) -> dict:
    """Compare synthetic rankings only when request/course labels are identical.

    Scores may differ, but the user, request, course, and explicit label must
    agree. This is a metric helper, not the project-approved experiment runner.
    """
    baseline_metrics = grouped_ranking_metrics(baseline, k)
    candidate_metrics = grouped_ranking_metrics(candidate, k)
    def labels_by_item(rows):
        return {(row["request_id"], row["course_id"]): (row["user_id"], row["label"]) for row in rows}
    if labels_by_item(baseline) != labels_by_item(candidate):
        raise ValueError("baseline and candidate must use identical requests, courses, users and labels")
    return {"baseline": baseline_metrics, "candidate": candidate_metrics}
