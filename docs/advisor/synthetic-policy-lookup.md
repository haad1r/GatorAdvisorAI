# Synthetic policy lookup

`lib/ai/synthetic-policy.ts` is an offline lookup exercise for issue #10. It
does not fetch UF policy or claim a fixture is authoritative. The caller supplies
invented fixtures containing a source ID, topic ID, exact catalog year, observed
date, title, and text. A strict request names a topic and catalog year.

The lookup returns all exact matches in stable source-ID order, or `unknown` if
none apply. It rejects malformed dates, nonconsecutive catalog years, duplicate
source IDs, and unexpected fields. Source text is returned as untrusted data;
the lookup does not create prompts or execute instructions. The injection test
only verifies this data boundary, not resistance of a real language model.

The future live service still needs an approved source allowlist, genuine
retrieval and source verification, catalog applicability and freshness rules,
policy evaluation, and backend ownership and access controls. Do not substitute
these synthetic fixtures for official policy or attach them to live answers.
`lib/ai/synthetic-flow.ts` connects the lookup to the synthetic Fact Pack and
claim validator for an end-to-end fixture exercise. It uses the requirement ID
as the synthetic policy topic, checks that the pack's referenced IDs and titles
match the lookup, and returns `evidence_unavailable` without calling the mock
provider when evidence is missing or inapplicable. Source text is not sent to
the mock provider. This fixture-only convention is not an official policy model.

Run `npx vitest run lib/ai` for the mocked checks, including the end-to-end flow.
