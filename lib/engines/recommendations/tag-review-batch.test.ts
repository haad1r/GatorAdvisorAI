import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { parseCsv } from "../catalog/csv"
import { interestIds, CourseTagSchema } from "./inputs"
import batch from "../../../data/recommendations/tag-review-batch-v1.json"

describe("pending course tag review batch", () => {
  it("uses real catalog descriptions and recognized interest IDs without claiming human review", () => {
    const catalog = parseCsv(readFileSync("data/catalog/courses.csv", "utf8"))
    const byId = new Map(catalog.map((course) => [course.id, course]))
    const seen = new Set<string>()
    expect(batch.status).toBe("pending_human_review")
    expect(batch.provenance).toBe("model_assisted_proposal")
    for (const candidate of batch.candidates) {
      const course = byId.get(candidate.course_id)
      expect(course, candidate.course_id).toBeDefined()
      expect(course!.catalog_year).toBe(batch.catalog_year)
      expect(course!.source_url).toMatch(/^https:\/\/catalog\.ufl\.edu\//)
      expect(course!.description).toContain(candidate.evidence)
      expect(interestIds).toContain(candidate.interest_id)
      expect(seen.has(`${candidate.course_id}:${candidate.interest_id}`)).toBe(false)
      seen.add(`${candidate.course_id}:${candidate.interest_id}`)
      // Pending proposals cannot masquerade as approved scorer inputs.
      expect(CourseTagSchema.safeParse(candidate).success).toBe(false)
    }
  })
})
