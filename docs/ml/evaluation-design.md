# Recommendation evaluation design

ML evaluation contract for [issue #11](https://github.com/haad1r/GatorAdvisorAI/issues/11) (explainable course recommendations). Product survey and interest definitions live in [`docs/recommendations/`](../recommendations/) (`survey_v1`, `interests_v1`) once merged—this document does not duplicate them.

**Owners:** Ryan — evaluation design, checkpoint reviews, real-data quality recommendation; Alan — deterministic scorer, features, offline pipeline; Sid — API and advisor-facing explanations; Haadi — experiment runner per agreed spec (#11 step 13).

**Status:** Deterministic baseline is the production default until a learned model passes the [data sufficiency gate](./data-sufficiency.md) and promotion review. Synthetic runs validate pipeline mechanics only; they are not evidence of recommendation quality.

---

## Baseline (must beat)

The **baseline** is the **deterministic ranker** described in issue #11 step 5 and implemented from:

- Survey answers (`survey_v1`) — see recommendation docs for Q1–Q6 semantics, hard vs preference, and skip behavior.
- Course interest tags (`interests_v1`, `tags_v*`) with provenance (`subject_default` vs `description_reviewed`).
- Academic engine outputs when available (TEAM-02): eligibility filtering before rank, major-to-subject for Q3, requirement-slot progress for Q5.

Until Alan and Sid publish a single formula in code, treat the baseline as a **weighted combination** of:

| Component | Source | Notes |
|-----------|--------|--------|
| Interest match | Q1 + course tags | Normalized overlap score per survey spec; skipped Q1 → component omitted, not zero |
| Avoid topics | Q2 | Hard filter only on `description_reviewed` tags; until those exist, **penalty** not filter (document in release notes) |
| Major scope | Q3 | Requires major + major-to-subject map (TEAM-02) |
| Course level | Q4 | From catalog course number |
| Requirement progress | Q5 | TEAM-02 requirement-slot data |
| Exploration diversity | Q6 | Measurable via interest spread in top-*k* (define in eval reports) |

**Default weights and tie-breaking** must be versioned (`scoring_v1`, etc.) in implementation. Ryan reviews weights at the agreed design checkpoint; changing weights bumps the scoring version and should be logged with impressions.

Any **learned model** is compared against this baseline on the **same** held-out examples and metrics below—not against an ad hoc or implicit ranker.

---

## Labels and training data (for offline / learned models)

When event persistence exists (TEAM-01):

| Event | Use |
|-------|-----|
| Impression (course, position, request/scoring versions) | Exposure logging; position-aware metrics |
| Selection / open detail | Weak positive |
| Like | Positive |
| Dislike / not-interested | Negative; suppress from future lists |

**Labels for ranking experiments** should be defined in the dataset spec (Alan) and approved at the evaluation checkpoint—for example binary relevance from like vs not-interested, or graded from explicit feedback only. Do not train on ineligible courses that should have been filtered pre-rank.

---

## Metrics

Report a **small fixed set** each run; add exploratory metrics in an appendix, not as go/no-go unless agreed.

### Pre-rank / safety (gate before ranking quality)

- **Eligibility precision:** share of top-*k* results that are eligible now (per engine rules).
- **Hard constraint violations:** must be **zero** for Q2 when acting as hard filter; track separately when Q2 is penalty-only.
- **Explanation alignment:** each displayed reason must map to inputs used in the score for that course (#11 acceptance).

### Ranking (offline, held-out)

- **NDCG@k** (e.g. *k* = 5, 10) on labeled pairs from feedback.
- **MRR** or hit-rate@*k* for “any positive in top-*k*” if labels are sparse.
- **Coverage:** fraction of catalog (or candidate pool) appearing in recommendations across a eval user set.
- **Diversity (exploring users):** e.g. entropy of interest IDs in top-*k* when Q6 = exploring; compare to settled profiles.

### Cold start

- Users with **no survey** and **no behavioral history** must still receive useful top-*k* (manual spot-check + automated checks on requirement-progress-only or catalog-popularity fallback if defined).

### Comparison reports (Haadi / Alan)

Each report records: `dataset_version`, `scoring_version`, `survey_version`, `interest_list_version`, `tag_version`, split definition, metric table, and **failure examples** (courses ranked too high/low with reasons).

---

## Data splits

- **No random row splits** on impressions alone.
- Use **user-level** holdout: some students entirely in test.
- Use **time-aware** holdout where possible: train on events before cutoff *T*, evaluate on events after *T* for held-out users or sessions.
- **Exposure bias:** document that users mostly see top positions; prefer position-aware or conservative interpretation when reporting offline lifts. Full IPS/debiasing is optional v2—must be stated in the report if omitted.

---

## Synthetic vs real data

| Data | Allowed use |
|------|-------------|
| Synthetic fixtures | Pipeline smoke tests, schema checks, runner correctness |
| Synthetic metrics in stakeholder updates | **Not allowed** as quality evidence |
| Real export (TEAM-01) after [data gate](./data-sufficiency.md) | Model comparison and deployment recommendation |

---

## Checkpoints (Ryan review)

1. **Design checkpoint (before heavy pipeline investment):** baseline formula/weights draft, label definition, metric list, split plan—aligned with `survey_v1` / `interests_v1`.
2. **Pipeline checkpoint:** Alan’s reproducible offline artifact (versioned dataset build, features, config, baseline metrics on synthetic **smoke** set only).
3. **Real-data checkpoint (after data gate):** one comparison baseline vs one candidate model; Ryan documents **deploy / do not deploy** with evidence.

Learned-model **promotion** on the advisor (#10) is a separate review; recommendation serving promotion follows thresholds agreed with Sid (see data sufficiency doc).

---

## Go / no-go for learned model (draft)

Promotion requires **all** of:

- Data gate **passed** (see [data-sufficiency.md](./data-sufficiency.md)).
- Candidate **beats baseline** on primary ranking metrics on held-out real data without regressing eligibility precision or hard-constraint checks.
- Failure modes documented (cold start, sparse tags, Q2 penalty mode).
- Rollback path: serve deterministic `scoring_v*` baseline (Sid).

Numeric thresholds (e.g. minimum NDCG lift) are **TBD** at pipeline checkpoint and recorded here when set.

---

## References

- GitHub [#11](https://github.com/haad1r/GatorAdvisorAI/issues/11) — recommendations
- GitHub [#10](https://github.com/haad1r/GatorAdvisorAI/issues/10) — advisor (learned-model promotion review)
- GitHub [#7](https://github.com/haad1r/GatorAdvisorAI/issues/7) — waits on data-sufficiency gate for learned-model review
