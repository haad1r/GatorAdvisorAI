# Preliminary scoring review

Review of `scoring_v1` for issue #11. `scoring_v2` now exposes the diversity
adjustment and adds level and outside-major reasons; Sid's contract review is
still needed. This is a code and synthetic-example
review, not Ryan's model-quality approval or evidence of recommendation quality.
The weights remain starting guesses until the agreed review checkpoint.

## Findings for the design checkpoint

- **Weights:** 0.50/0.25/0.15/0.10 by default and 0.35/0.40/0.15/0.10
  when requirements are preferred or Q1 is skipped. Missing components are
  removed and the remaining weights rescaled. Compare the effect on realistic
  profiles and ask Ryan to approve any changes and version them.
- **Diversity and explanations:** exploration (or skipped Q1) subtracts 0.1
  per previously selected course sharing an interest. The returned `score` is
  the unadjusted score and the reasons do not expose the diversity penalty.
  Thus a lower displayed score can appear above a higher one without an
  explanation. Agree with Sid on exposing the adjustment and its reason before
  using these results in the advisor or UI.
- **Cold start:** with all answers skipped, requirement-filling courses score
  above other courses initially, but the accumulated diversity penalty can
  eventually put a non-requirement course ahead of one filling a requirement.
  Confirm whether this tradeoff matches the intended fallback; the current
  wording in the baseline spec can imply an absolute requirement-first order.
- **Reasons:** the scorer emits no level reason even when level affects the
  score, and no outside-major reason when that preference affects it. Confirm
  the desired explanation contract with Sid. Score components are weighted
  contributions before normalization, not necessarily values that sum to the
  displayed score.
- **Scale:** `rank` now tracks overlap incrementally and scans the remaining pool
  for each selection, instead of repeatedly sorting and recounting all prior
  selections. Synthetic comparisons check the previous ordering. This remains
  quadratic in the candidate count; measure full-catalog latency before serving.
- **Safety boundary:** the scorer itself does not filter eligibility, completed
  courses or dismissals. Engine candidate filtering, dismissal handling,
  reviewed tags, and the issue's handoff and smoke checks remain prerequisites
  for live recommendations. Unknown eligibility must not be advertised as eligible.

The branch `origin/Ryan-Branch` also contains a draft evaluation design; coordinate
with its owner before reconciling it with the merged survey specification. In
particular, the merged survey treats Q2 as a preference rather than a hard filter.
