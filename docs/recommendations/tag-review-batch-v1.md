# Starter course-interest tag review

[`tag-review-batch-v1.json`](../../data/recommendations/tag-review-batch-v1.json)
contains 46 model-assisted proposals for 45 catalog courses from 2026–2027.
Each includes an exact excerpt of the committed catalog description; look up
the matching `id` in `data/catalog/courses.csv` for the full description and
source URL. The accompanying test checks IDs, catalog year, interest IDs,
duplicate pairs and evidence excerpts against that file.

**Status: pending human review.** These are proposals, not `tags_v1` records,
not `description_reviewed` tags, and not input to the scorer. No human
reviewer has approved them. They are a small, nonrepresentative starter batch;
do not infer catalog-wide coverage or recommendation quality from it.

For each proposal, a human reviewer should inspect the full description and
source, accept, revise or reject the proposed interest, and record their name
and review decision. Once the team agrees on a dataset and version, accepted
records can be converted to the documented tag contract with the catalog's
display course code (e.g. `CAP 4621`), `description_reviewed`, the reviewer,
the agreed tag version, and `interests_v1`. Validate the converted records and
check current catalog evidence before use. A changed description requires a
new review. Do not invent reviewer identities or treat this batch as complete.
