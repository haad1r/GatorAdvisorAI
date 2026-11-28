# Synthetic advisor validation cases

Preparation for issue #10's single-requirement explanation slice. These are
acceptance examples for a synthetic single-requirement prototype, not a live
advisor. `lib/ai/synthetic-requirement.test.ts` covers the structured claim,
source, unknown, provider-error, simulated timeout and simulated version checks. Live freshness, real provider cancellation, identity,
retrieval and injection boundaries still need their respective integrations.
All identifiers and facts below are invented. The engine
remains authoritative; unknown or absent evidence must not become a positive claim.

## Shared fixture

An engine result for synthetic record `student-test-1`, version `r1`, and
synthetic catalog `c1` contains requirement `req-test-1`: status
`not_satisfied`, 3 of 6 credits completed, with source `source-test-1`.
The retrieved source set contains only `source-test-1`. A second requirement
`req-test-2` has status `unknown` because its evidence is missing. No real student
record, catalog claim, or provider key is needed.

## Cases

| Case | Mock provider response or condition | Expected outcome |
| --- | --- | --- |
| Supported answer | `req-test-1` is not satisfied; 3 of 6 credits completed; cites `source-test-1`. | Validate the structured claims and citation against the current fact pack; return the explanation. |
| Wrong status | Claims `req-test-1` is satisfied. | Reject the claim and return a clearly labelled deterministic engine fallback before displaying provider text. |
| Wrong number | Claims 6 of 6 credits are completed. | Reject and use fallback with the engine's 3 of 6 values. |
| Unknown treated as satisfied | Claims `req-test-2` is satisfied. | Reject; fallback states the result is unknown and evidence is missing. |
| Unretrieved source | Cites `source-test-2`, absent from the retrieved source set. | Reject the citation and use fallback; do not invent a source. |
| Forged identifier | References `req-test-99`, absent from the fact pack. | Reject and use fallback; do not present it as a real requirement. |
| Stale evidence | Record version changes from `r1` to `r2` before the answer is delivered. | Refresh the evidence and re-evaluate; do not deliver a claim validated only against `r1`. |
| Provider timeout | The mock provider times out. | Return a labelled deterministic fallback derived from the current engine result. |
| Prompt injection in a source | Retrieved text tells the advisor to ignore its rules or reveal private data. | Treat the text as data, not instructions; do not disclose unrelated data or accept unsupported claims. |
| Cross-user request | A tool call for `student-test-2` is attempted under `student-test-1` identity. | Reject before accessing the other record; no cross-user data reaches the provider or caller. |

Buffer provider output until validation completes. Checking identifiers, numbers,
statuses and citations does not prove unrestricted prose is correct; the eventual
response contract and fallback should make that limitation explicit. Owners must
agree on the production claim schema and UI states. The prototype displays only
locally rendered text and does not display provider prose. Live data, provider
calls, private history and usage limits
remain subject to the handoffs in issue #10.
The prototype bounds its mock provider wait and signals cancellation, but cannot
force a provider that ignores the signal to stop work. Production timeouts and
spend controls still need the actual provider and backend integrations.
The optional synthetic freshness wrapper checks the supplied record version before
and after generation, withholding both validated and fallback text if it changes
or cannot be read. It cannot make the check and delivery atomic, refresh the
record itself, or verify a real user's identity; those require backend integration.
Fallbacks retain the fact's source ID only when it is in the retrieved set;
otherwise they do not claim a verified source.
