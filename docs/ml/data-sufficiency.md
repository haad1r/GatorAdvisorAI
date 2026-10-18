# Data sufficiency gate (real-data ML)

Defines when the team may treat **real user feedback** as sufficient for offline training comparison and for Ryan’s **model-quality recommendation** ([#11](https://github.com/haad1r/GatorAdvisorAI/issues/11) step 11). Also unblocks [#7](https://github.com/haad1r/GatorAdvisorAI/issues/7) “learned-model review” and Haadi’s experiment runner ([#11](https://github.com/haad1r/GatorAdvisorAI/issues/11) step 13) for **real-data** runs.

Until this gate passes, production serves the **deterministic baseline** only; synthetic experiments may run for plumbing only (see [evaluation-design.md](./evaluation-design.md)).

**Gate owner:** Ryan documents criteria and records pass/fail. **Export owner:** Maria (TEAM-01 event export and development access).

---

## Prerequisites (access, not sufficiency)

All must be true before counting data toward the gate:

- [ ] TEAM-01 **event export** API or batch export documented with schema version.
- [ ] Export includes: impressions (position, scoring/survey versions), feedback types (like, dislike, not-interested), selections, and account deletion behavior verified.
- [ ] Development/staging access for Ryan and Haadi to run holdout eval **without** production PII in notebooks/repos.
- [ ] Alan’s offline pipeline can ingest the export format (`dataset_version` pinned).

Missing prerequisites → status **BLOCKED (access)**, not “insufficient data yet.”

---

## Sufficiency criteria (draft — numbers TBD at pilot)

Record actual numbers in the gate decision when the export first becomes available. Suggested dimensions:

| Dimension | Draft guidance | Recorded value |
|-----------|----------------|----------------|
| Calendar span | ≥ 2 weeks of pilot traffic after recommendations UI is live | TBD |
| Unique users with ≥1 impression | Enough for user holdout (target ≥ 50; revise with team) | TBD |
| Users with ≥1 explicit feedback label | Enough for ranking metrics (target ≥ 30; revise with team) | TBD |
| Impressions per scoring version | Sufficient to compare before/after weight changes | TBD |
| Tag coverage | `description_reviewed` tags cover enough courses that Q2 behavior is representative, or eval scope excludes Q2 hard-filter mode | TBD |

**Empty or synthetic-only event tables do not satisfy the gate.**

---

## Quality checks

Before **PASS**, confirm:

- [ ] **Idempotency:** repeated feedback does not duplicate training rows (per #11).
- [ ] **Deletion:** exported data respects account deletion within agreed latency.
- [ ] **Version fields:** `survey_version`, `interest_list_version`, `scoring_version` present on impressions where required.
- [ ] **No training on ineligible:** candidate pool in export matches pre-rank filters, or eval script re-applies engine rules.
- [ ] **Label integrity:** not-interested and dismissals reflected in labels used for ranking eval.

Failures → **FAIL** with remediation owner (usually Maria or Alan).

---

## Gate decision

Publish one short decision per attempt (issue comment or PR to this file):

```text
Gate decision: PASS | FAIL | BLOCKED (access)
Date:
Export schema version:
Dataset version:
Ryan:
Notes:
```

- **PASS:** Haadi may run real-data baseline vs candidate comparison; Ryan schedules real-data checkpoint per evaluation-design.md.
- **FAIL:** Document what is missing; deterministic baseline remains; do not cite partial real-data metrics as quality proof.
- **BLOCKED (access):** resolve with Maria before re-evaluating counts.

---

## After PASS (out of scope for gate doc)

- Ryan: one real-data comparison and written **deploy / do not deploy** recommendation.
- Sid: serving and model version only if promoted.
- Retraining cadence and production ML infra remain future scope unless explicitly opened.

---

## References

- [evaluation-design.md](./evaluation-design.md) — metrics, splits, checkpoints
- [`docs/recommendations/`](../recommendations/) — survey and interest versions (when merged)
