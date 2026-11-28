import { describe, expect, it } from "vitest"
import { descriptionFingerprint, prepareReviewedTag } from "./tag-review"
import { tagForScoring } from "./inputs"

const proposal = { course_id: "abc1000", interest_id: "ai_data", evidence: "synthetic data science" }
const snapshot = { code: "ABC 1000", description: "A synthetic data science course.", catalogYear: "2026-2027", sourceUrl: "https://catalog.ufl.edu/example/" }
const decision = { decision: "accept", reviewer: "synthetic-reviewer", reviewedAt: "2026-01-01T00:00:00Z", catalogYear: "2026-2027", tagVersion: "tags_v1", descriptionSha256: descriptionFingerprint(snapshot.description) }

describe("tag review preparation", () => {
  it("produces a scorer-compatible tag and traceable review evidence after an explicit acceptance", () => {
    const result = prepareReviewedTag(proposal, snapshot, decision)
    expect(tagForScoring(result.tag)).toEqual({ interest: "ai_data", source: "description_reviewed" })
    expect(result.review).toMatchObject({ sourceUrl: snapshot.sourceUrl, descriptionSha256: decision.descriptionSha256, evidence: proposal.evidence })
  })
  it("rejects a stale catalog description or mismatched catalog year", () => {
    expect(() => prepareReviewedTag(proposal, { ...snapshot, description: snapshot.description + " changed" }, decision)).toThrow(/changed/)
    expect(() => prepareReviewedTag(proposal, { ...snapshot, catalogYear: "2027-2028" }, decision)).toThrow(/year/)
  })
  it("rejects absent evidence, mismatched courses, untrusted source URLs and unaccepted reviews", () => {
    expect(() => prepareReviewedTag({ ...proposal, evidence: "missing" }, snapshot, decision)).toThrow(/absent/)
    expect(() => prepareReviewedTag({ ...proposal, course_id: "xyz1000" }, snapshot, decision)).toThrow(/course/)
    expect(() => prepareReviewedTag(proposal, { ...snapshot, sourceUrl: "https://catalog.ufl.edu.example.org/" }, decision)).toThrow(/official/)
    expect(() => prepareReviewedTag(proposal, snapshot, { ...decision, decision: "reject" })).toThrow()
    expect(() => prepareReviewedTag(proposal, snapshot, { ...decision, reviewer: " " })).toThrow()
  })
})
