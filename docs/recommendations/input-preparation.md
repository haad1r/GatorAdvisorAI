# Recommendation input preparation

`lib/engines/recommendations/inputs.ts` provides provisional, pure validators
for the documented `survey_v1` submission and `interests_v1` tag vocabulary.
They do not store data or call the academic engine. `surveyForScoring` rejects
unknown versions, invalid or duplicate answers and overlapping positive and
lower-interest selections, then omits skipped and hidden answers from scoring.
It expects one answer record for each of the six questions, including skipped
or hidden ones. Conditional visibility and defaults depend on profile data and
must be enforced by the owning frontend/backend when available.

`tagForScoring` validates a versioned tag and requires a nonempty reviewer for
`description_reviewed` provenance. The presence of a reviewer field does not
prove that a review occurred. The team must review actual catalog descriptions
and approve the tag dataset before it affects students. Subject-default tags
remain defaults, and never count as reviewed negative-interest evidence.

The test fixture is synthetic. These helpers do not implement event logging,
training, academic eligibility, data access, or an API. The survey/API shapes
remain provisional until the relevant owners confirm their contracts; do not
replace the shared persistence layer or use these helpers as an authorization
boundary. See issue #11 for required handoffs and real-data evaluation gates.
