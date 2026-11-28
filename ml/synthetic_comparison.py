"""Reproducible synthetic-only comparison smoke test; not a deployment evaluation.

No external data is read. The TypeScript process invokes the actual local
baseline scorer; this is not an approved real-data experiment runner.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synthetic_dataset import CUTOFF, DATASET_VERSION
from synthetic_metrics import compare_synthetic_rankings
from synthetic_training import FEATURES, MODEL_VERSION, SEED, train_synthetic

ROOT = Path(__file__).resolve().parent.parent
REPORT_VERSION = "synthetic_comparison_v2"


def synthetic_comparison():
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js with TypeScript stripping is required")
    _, rows, predictions = train_synthetic()
    held_out = rows[rows.partition == "test"].to_dict("records")
    features = [{name: row[name] for name in FEATURES} for row in held_out]
    process = subprocess.run([node, str(ROOT / "scripts/synthetic-baseline.ts")], input=json.dumps(features),
                             capture_output=True, text=True, encoding="utf-8", check=True, timeout=60, cwd=ROOT)
    baseline = json.loads(process.stdout)
    if len(baseline["scores"]) != len(held_out) or len(predictions) != len(held_out):
        raise ValueError("synthetic score count does not match held-out rows")
    baseline_rows, candidate_rows = [], []
    for row, baseline_score, candidate_score in zip(held_out, baseline["scores"], predictions, strict=True):
        shared = {key: row[key] for key in ("request_id", "user_id", "course_id", "label")}
        baseline_rows.append({**shared, "score": float(baseline_score)})
        candidate_rows.append({**shared, "score": float(candidate_score)})
    metrics = compare_synthetic_rankings(baseline_rows, candidate_rows, k=2)
    examples = []
    for request_id in sorted({row["request_id"] for row in baseline_rows}):
        baseline_group = [row for row in baseline_rows if row["request_id"] == request_id]
        candidate_group = [row for row in candidate_rows if row["request_id"] == request_id]
        baseline_first = sorted(baseline_group, key=lambda row: (-row["score"], row["course_id"]))[0]
        candidate_first = sorted(candidate_group, key=lambda row: (-row["score"], row["course_id"]))[0]
        if baseline_first["course_id"] != candidate_first["course_id"]:
            examples.append({"request_id": request_id, "baseline_top": baseline_first["course_id"],
                             "baseline_label": baseline_first["label"], "candidate_top": candidate_first["course_id"],
                             "candidate_label": candidate_first["label"]})
        if len(examples) == 3:
            break
    return {"report_version": REPORT_VERSION, "data": "synthetic_only", "purpose": "mechanics_check_not_quality_evidence",
            "dataset_version": DATASET_VERSION, "scoring_version": baseline["scoring_version"],
            "model_version": MODEL_VERSION, "seed": SEED, "features": FEATURES, "cutoff": CUTOFF.isoformat(),
            "split": "user_holdout_and_time_cutoff", "k": 2, "metrics": metrics, "synthetic_disagreement_examples": examples,
            "limitations": ["generated labels", "no exposure-bias correction", "not approved for real data or deployment"]}


if __name__ == "__main__":
    print(json.dumps(synthetic_comparison(), sort_keys=True))
