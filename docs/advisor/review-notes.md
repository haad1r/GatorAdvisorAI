# Advisor synthetic slice: review notes

Issue #10 independent preparation. A synthetic flow validates one tool request,
looks up an exact topic/catalog-year fixture, verifies referenced source IDs,
checks one mock provider claim against a supplied fact, and renders a result or
fallback. Provider prose and source text are not rendered as instructions.
Simulated stale evidence is withheld. All fixtures are invented.

Reviewers should assess:

1. Whether the proposed request, Fact Pack and frontend response states are
   suitable starting points for the real owner-approved contracts.
2. Whether the fallback and missing-evidence behavior are understandable to a
   consumer, including `unknown` and `evidence_unavailable`.
3. What changes are needed for real source resolution, catalog applicability,
   engine versions and a single-requirement explanation.

Run `npx vitest run lib/ai --testTimeout=20000`, `npm run typecheck`, and
`npx eslint lib/ai`. No provider keys, network calls or student data are needed.

This is not a deployable advisor. It does not perform authentication or
authorization, actual catalog retrieval, live engine calls, private history,
atomic freshness checks, provider billing controls, or real provider calls.
It does not show AI-generated prose. The issue #10 access and ownership gates
still apply; production contract decisions and integration remain open.
