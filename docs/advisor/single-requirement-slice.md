# Synthetic single-requirement advisor slice

Issue #10, independent preparation. `lib/ai/synthetic-requirement.ts` accepts
one synthetic fact and an injected mock provider. The caller supplies a current
record-version reader to `explainIfSyntheticEvidenceCurrent`. No API route,
identity check, database, policy retrieval, real academic engine, or Gemini
provider is included. Do not use this prototype with student data.

`synthetic-audit-adapter.ts` additionally exercises a committed synthetic
`AuditResult` fixture. It validates the engine schema and extracts one
requirement's status, credit amounts, versions and source references. Those
references are not proof of retrieval, so the adapter deliberately does not
assign a verified source ID or claim a live integration.

## Contract for discussion

- **Input:** one requirement ID, its status, completed and required credits
  (nullable), an optional source ID, the set of retrieved source IDs, and the
  synthetic record version. IDs are restricted to bounded identifier characters.
- **Mock provider:** returns the same structured fields as a claim. Arbitrary
  prose, unknown fields and malformed output are rejected. Display text is
  produced locally from the fact, not from provider text.
- **`validated`:** the structured claim matches all supplied fields and cites
  a source present in the retrieved set. Text still comes from the fact; this
  prototype does not demonstrate AI-generated explanations.
- **`engine_fallback`:** provider error, timeout, malformed or mismatched claim.
  The text is rendered from the supplied fact. A source ID is returned only if
  that ID was retrieved. This is a mock-engine fallback, not a live engine call.
- **`evidence_unavailable`:** version mismatch, failed version lookup or invalid
  fact pack. No requirement status, credit value, or source is displayed; the
  caller should refresh evidence before retrying.
- **Pending:** the caller may display a progress state while the promise is
  pending. The prototype does not stream unvalidated chunks.

An `unknown` requirement stays unknown in either validated or fallback text.
The mock provider is given an abort signal and a bounded wait; a provider may
ignore the signal, so this does not establish production cancellation or costs.
Version checks before and after generation are not atomic with delivery. The
real backend must enforce authorization, obtain fresh evidence, handle version
changes and timeouts, and enforce atomic usage/spend limits. Those are not
implemented here. Source resolution and catalog-year applicability also need
the policy-retrieval handoff. The exact UI/API contract remains subject to owner
review.

## Verify

From the repository root: `npx vitest run lib/ai/synthetic-requirement.test.ts`.
Fixtures and provider responses in these tests are synthetic. See
[synthetic-validation-cases.md](synthetic-validation-cases.md) for covered and
future cases.
