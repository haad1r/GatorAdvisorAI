# Recommendation integration handoff and test scenarios

Issue #11 preparation for the engine, backend, advisor, and frontend owners.
These are acceptance scenarios and open questions, not an API specification or
an implemented mock service. Use synthetic students and course IDs in checks.

## Required handoffs

- **Academic engine (TEAM-02):** owner-confirmed, tested access and versioned
  contracts for eligibility, target-term offering, requirement contribution, and
  plan-add validation. Preserve `yes`, `no`, and `unknown` flags; the proposed
  `toScoringFlags` change returns `null` for unknown and needs owner review.
  Agree on current versus conditional eligibility and
  repeatable-course semantics before exposing recommendations.
- **Backend (TEAM-01):** shared identity, survey, impression, feedback and
  export interfaces, including idempotency and account deletion semantics.
  Request/version fields and event retention must be agreed with the owner;
  do not create an independent event store.
- **Recommendation/advisor API (Sid):** agree on target term, eligibility
  evidence, requirement contribution, scoring version, base and adjusted
  score, reasons and error/unknown states. Provider-facing explanations must
  use the same ranking result, not recompute eligibility.
- **Frontend (TEAM-09):** receive the tested API and development access, then
  confirm display, impression timing, feedback and error states in staging.
  API work does not wait for the frontend once upstream handoffs are complete.

## Synthetic acceptance scenarios after handoff

| Scenario | Expected observable behavior |
| --- | --- |
| A candidate is ineligible, already held, or explicitly dismissed | It is excluded before scoring and from the displayed result. |
| Eligibility or term availability is unknown | It is not presented as confirmed eligible; return the agreed unknown state. |
| Requirement contribution is unknown with an outside-major preference | It does not receive an outside-major boost or reason. |
| A reviewed lower-interest tag matches | The relevant score is reduced and the explanation names the tag and provenance. |
| A student changes survey answers | A newly generated ranking uses the new version; previously logged impressions retain their original versions. |
| An impression or feedback request is retried | The shared persistence interface applies its agreed idempotency contract; no duplicate event results. |
| A course is marked not interested | The next recommendation response suppresses it after the persisted event succeeds. |
| A recommendation is added to a plan | Server-side TEAM-02 validation runs again and can reject stale or invalid eligibility. |
| A recommendation result is used by the advisor | Displayed scores and reasons match the versioned recommendation result. |
| Account deletion is completed | Events and exports follow the backend's documented deletion policy. |

Before dependent integration, issue #11 requires owner confirmation, access and
versioned setup details, and a successful smoke check. This document does not
assert that any handoff has occurred.

`lib/engines/recommendations/engine-smoke.test.ts` exercises the local academic
engine with its synthetic record and the committed catalog, then passes a small
candidate sample to scoring. It checks that held/unknown eligibility is not
presented as a candidate and demonstrates preserving unknown requirement flags.
Course tags and levels in this check are placeholders. This is useful local
evidence, not the owner-confirmed access and integration handoff, a dismissal
test, or evidence of recommendation quality.

`synthetic-pipeline.ts` is a separate fixture-only exercise joining engine
filtering, explicit in-memory dismissals, requirement flags and ranking. It
returns eligibility and requirement evidence, excludes unsupported course
levels, and deduplicates course IDs. Its tests use synthetic records and tags.
It has no API, authentication, persistence, feedback-event processing or
section validation. Do not serve its output; the owner-confirmed handoffs and
review remain required before live integration.
