import { createHash } from "node:crypto"
import { z } from "zod"
import { toCourseId } from "../schemas/common"
import { CourseTagSchema } from "./inputs"

// Local review preparation only: no reviewer authentication or persistence.
const Proposal = z.strictObject({ course_id: z.string(), interest_id: z.string(), evidence: z.string().trim().min(1) })
const Snapshot = z.strictObject({
  code: z.string(), description: z.string().min(1), catalogYear: z.string().regex(/^\d{4}-\d{4}$/),
  sourceUrl: z.url(),
})
const Decision = z.strictObject({
  decision: z.literal("accept"), reviewer: z.string().trim().min(1).max(100),
  reviewedAt: z.iso.datetime({ offset: true }), descriptionSha256: z.string().regex(/^[a-f0-9]{64}$/),
  catalogYear: z.string().regex(/^\d{4}-\d{4}$/), tagVersion: z.string().regex(/^tags_v[1-9]\d*$/),
})

/** Fingerprint the exact catalog description shown for a human review. */
export function descriptionFingerprint(description: string) {
  return createHash("sha256").update(description, "utf8").digest("hex")
}

/** Convert an explicitly accepted proposal to a tag plus review evidence. */
export function prepareReviewedTag(proposalValue: unknown, snapshotValue: unknown, decisionValue: unknown) {
  const proposal = Proposal.parse(proposalValue)
  const snapshot = Snapshot.parse(snapshotValue)
  const decision = Decision.parse(decisionValue)
  const url = new URL(snapshot.sourceUrl)
  if (url.protocol !== "https:" || url.hostname !== "catalog.ufl.edu" || url.username || url.password || url.port) throw new Error("Expected an official UF catalog URL")
  if (toCourseId(snapshot.code) !== proposal.course_id) throw new Error("Proposal course does not match catalog snapshot")
  if (decision.catalogYear !== snapshot.catalogYear) throw new Error("Catalog year changed since review")
  if (descriptionFingerprint(snapshot.description) !== decision.descriptionSha256) throw new Error("Catalog description changed since review")
  if (!snapshot.description.includes(proposal.evidence)) throw new Error("Proposed evidence is absent from description")
  const tag = CourseTagSchema.parse({ course_id: snapshot.code, interest_id: proposal.interest_id,
    source: "description_reviewed", interest_list_version: "interests_v1", tag_version: decision.tagVersion,
    reviewed_by: decision.reviewer })
  return { tag, review: { reviewedAt: decision.reviewedAt, catalogYear: snapshot.catalogYear,
    sourceUrl: snapshot.sourceUrl, descriptionSha256: decision.descriptionSha256, evidence: proposal.evidence } }
}
