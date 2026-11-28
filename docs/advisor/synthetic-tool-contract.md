# Proposed synthetic advisor tool contract

`lib/ai/synthetic-contracts.ts` defines a discussion-only contract for issue
#10. It is not a registered tool or a replacement for backend authorization.

The only accepted request is `{"tool":"explain_requirement","requirementId":"req-1"}`.
The strict schema rejects additional fields, including user IDs, and any other
tool name. The backend must obtain identity from its authenticated session and
check access before loading any fact pack; rejecting an input field is not an
ownership check.

The synthetic pack has a schema version, record and catalog versions, an
allowlist of requirement IDs, one structured requirement with optional credit
values and unknown reason, and a set of retrieved source IDs and titles. It
rejects unmatched or duplicate IDs and references to sources outside that set.
The request must name the requirement in the pack. The schema only validates
internal consistency: it cannot establish that a source was actually fetched,
that a fact came from the engine, or that the current user can access it.

This shape is a draft. A fixture-only adapter connects it to the synthetic
single-requirement prototype; there is no live adapter. Engine owners and consumers must agree on
the actual result, source and version contracts. Do not use these fixtures with
student data or pass untrusted source text as provider instructions. The real
service still needs source dates and catalog applicability, policy retrieval,
timeouts, private history, quotas, and access control.

Run `npx vitest run lib/ai/synthetic-contracts.test.ts` for the synthetic checks.
