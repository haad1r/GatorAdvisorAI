# GatorAdvisor scoring baseline: scoring_v2 (preliminary)

Issue #11, step 5. Follows [survey.md](survey.md) (`survey_v1`) and
[interest-list.md](interest-list.md) (`interests_v1`).

**Status: preliminary.** The code is `lib/engines/recommendations/scoring.ts`, with
checks in `scoring.check.ts`. The academic engine now exposes candidate filtering
and requirement flags; see [its integration notes](../../lib/engines/README.md#recommendation-scoring).
The scorer still accepts flags as inputs and its checks use **synthetic** fixtures.
The engine handoff, access and smoke checks in issue #11 are still required before
live integration. These checks establish behavior, not recommendation quality.
Do not serve live recommendations from this yet.

The ranking loop tracks diversity overlaps incrementally and selects by a scan.
It preserves the previous ordering in synthetic comparisons but remains quadratic
in pool size; full-catalog latency still needs measurement before live use.

Run the checks from the repo root:

```bash
node lib/engines/recommendations/scoring.check.ts
```

## 1. Pipeline

```
all courses
  -> HARD FILTERS (not part of scoring, done by other services):
       academic eligibility, already completed, explicitly dismissed
  -> SCORE the remaining courses
  -> SORT by score, break ties by course code
  -> if exploring or Q1 skipped: spread the list across interests
  -> RETURN ranked list with components and reasons
```

All six survey answers are preferences. None removes a course.

## 2. The score

```
score = ( w_interest*interest + w_req*req + w_major*major + w_level*level )
        / (sum of the weights that were used)
```

A component that is skipped (question unanswered or hidden, or no data) is
dropped and the remaining weights are rescaled. Missing data is never scored as bad.

| Component | Survey question | Value |
|---|---|---|
| `interest` | Q1 `interests`, Q2 `lower_interest_topics` | share of the course's tags the student picked, minus the share marked "less". Can be negative. |
| `req` | Q5 `requirement_progress`, slot data | 1 if the course fills any open requirement slot, else 0 |
| `major` | Q3 `major_scope`, slot data | `inside_major`: 1 if it fills a major slot. `outside_major`: the reverse. `mix` or hidden: skipped. |
| `level` | Q4 `course_level` | 1 if it matches intro/advanced, else 0. `no_preference`: skipped. |

**Weights (configurable, versioned, starting guesses for Ryan to review)**

| Case | interest | req | major | level |
|---|---|---|---|---|
| Default | 0.50 | 0.25 | 0.15 | 0.10 |
| Q5 = yes, or Q1 skipped | 0.35 | 0.40 | 0.15 | 0.10 |

## 3. Decisions made (and why)

- **Q2 counts only `description_reviewed` tags.** Subject-level tags are too
  broad for a negative signal (matches the merged survey).
- **Q2 is not clamped at 0.** Otherwise "interest you less" would do nothing to a
  course with no Q1 match.
- **Q1 skipped, Q2 filled:** Q2 still applies as a penalty, and the student gets
  the cold-start fallback. Ignoring a filled answer would break the rule that
  every question must change a result.
- If Q1 is skipped and Q2 has no matching description-reviewed tag on a course,
  omit the interest component: adding a zero would change normalization even
  though there is no negative evidence.
- **Cold-start fallback (Q1 skipped):** requirement-filling courses first, then
  the list is spread across interests. Avoids an alphabetical list.
- **Spreading:** each already-chosen course sharing a tag lowers the next by 0.1.
- **Course with no tags:** the interest component is skipped.
- **Tie-break:** course code, so the order never reshuffles.
- **Q1 and Q2 overlap is rejected** before scoring.

## 4. Test run (synthetic)

| Student | Result |
|---|---|
| A: wants requirements, inside major | STA 3100 first, 0.725 = 0.35x0.5 + 0.40x1 + 0.15x1 + 0.10x0 |
| B: likes psychology, less interested in environment | CLP 3144 first (0.667). ANT 2402 gets "Lowered: tagged environment_agriculture (description_reviewed)". |
| C: skipped everything | Requirement-filling courses first, then spread by interest |
| D: skipped Q1, filled Q2 only | ANT 2402 (0.300) ranks below where it would otherwise be (0.533 for a requirement course with no lowered tag) |

Eight checks in the script pass, including determinism, Q2 lowering a score when
Q1 is skipped, subject-default tags never lowering a score, untagged courses,
and Q1/Q2 overlap being rejected.

## 5. Output contract (per course)

```json
{ "rank": 1, "code": "STA 3100", "score": 0.725,
  "components": { "interest": 0.175, "req": 0.4, "major": 0.15, "level": 0 },
  "reasons": ["Matches your interest in ai_data", "Counts toward a requirement", "Counts toward your major"],
  "diversity_penalty": 0, "adjusted_score": 0.725,
  "scoring_version": "scoring_v2" }
```

`score` remains the normalized base score. `diversity_penalty` is the adjustment
at the moment this course is selected, and `adjusted_score` is the base score
minus that penalty. A nonzero penalty also adds a reason. Adjusted scores are
selection-time values: penalties for remaining courses can grow on later picks.
Components are weighted contributions before normalization. Version 2 changes
the explanation contract and corrects Q2-only missing-evidence normalization;
the scoring weights and diversity ranking algorithm are unchanged. It
also adds reasons for matching level and outside-major preferences. Sid must
review the contract before it is exposed through the advisor API.

Every reason corresponds to a component or adjustment used in ranking. Impressions should
log `scoring_version`, `survey_version`, and `interest_list_version`.

## 6. Open questions

1. ML review: are the weights and the 0.1 spreading step acceptable for the design
   checkpoint? Is the cold-start fallback acceptable?
2. Survey owner: confirm that Q1 skipped plus Q2 filled behaves as in section 3.
3. Academic engine (TEAM-02): confirm the handoff and smoke checks for the published
   candidate filter and requirement flags before connecting them to the scorer.
4. Advisor (#10): is the output in section 5 enough for the recommendation tool?
5. Where should scoring code live long term? This PR uses `lib/engines/recommendations/`
   because the README proposes `lib/engines/`; move it if the team prefers elsewhere.
