// Dependency-free checks for scoring.ts. All data here is SYNTHETIC.
// Run from the repo root:  node lib/engines/recommendations/scoring.check.ts
// (Node strips the types; the app never imports this file.)

import assert from "node:assert/strict"
// @ts-expect-error TS5097: Node needs the .ts extension to run this script directly
import { rank, scoreCourse, SCORING_VERSION, type Course, type Source, type Survey } from "./scoring.ts"

void SCORING_VERSION

// ---------------- synthetic data ----------------
const R: Source = "description_reviewed", D: Source = "subject_default"
const courses: Course[] = [
  { code: "STA 2090", level: "intro",    fillsMajorSlot: false, fillsRequirement: false, tags: [{ interest: "ai_data", source: R }, { interest: "sports_fitness", source: R }] },
  { code: "STA 3100", level: "advanced", fillsMajorSlot: true,  fillsRequirement: true,  tags: [{ interest: "ai_data", source: R }, { interest: "programming_software", source: D }] },
  { code: "ANT 2402", level: "intro",    fillsMajorSlot: false, fillsRequirement: true,  tags: [{ interest: "society_social_sciences", source: R }, { interest: "environment_agriculture", source: R }] },
  { code: "AMH 1072", level: "intro",    fillsMajorSlot: false, fillsRequirement: false, tags: [{ interest: "history_culture_philosophy", source: D }, { interest: "environment_agriculture", source: D }] },
  { code: "CLP 3144", level: "advanced", fillsMajorSlot: false, fillsRequirement: false, tags: [{ interest: "psychology_behavior", source: R }, { interest: "health_medicine", source: R }] },
]
const students: Record<string, Survey> = {
  "A: wants requirements, inside major": { interests: ["ai_data", "sports_fitness"], course_level: "intro", requirement_progress: "yes", major_scope: "inside_major" },
  "B: likes psychology, less interested in environment": { interests: ["psychology_behavior", "health_medicine"], lower_interest_topics: ["environment_agriculture"] },
  "C: skipped everything (cold start)": {},
  "D: skipped Q1, filled Q2 only": { lower_interest_topics: ["environment_agriculture"] },
}

// ---------------- checks ----------------
const get = (rows: ReturnType<typeof rank>, code: string) => rows.find((r) => r.code === code)!

// 1. Hand-verified: STA 3100 for student A = 0.35*0.5 + 0.40*1 + 0.15*1 + 0.10*0 = 0.725
const a = rank(courses, students["A: wants requirements, inside major"])
assert.equal(a[0].code, "STA 3100")
assert.equal(a[0].score, 0.725)

// 2. Deterministic: same input, same output
assert.deepEqual(rank(courses, students["A: wants requirements, inside major"]), a)

// 3. Q2-only student: a reviewed "less" tag lowers the course versus the same course with no Q2
const withQ2 = get(rank(courses, students["D: skipped Q1, filled Q2 only"]), "ANT 2402").score
const noQ2 = get(rank(courses, {}), "ANT 2402").score
assert.ok(withQ2 < noQ2, "Q2 must lower a course even when Q1 is skipped")

// 4. subject_default tags never lower a score (AMH 1072 only has default env tag)
const amh = scoreCourse(courses[3], students["D: skipped Q1, filled Q2 only"])
assert.deepEqual(amh.reasons, [])

// 5. Skipping everything never crashes and gives finite scores
assert.ok(rank(courses, {}).every((r) => Number.isFinite(r.score)))

// 6. A course with no tags is handled, not scored as bad
const untagged = scoreCourse({ code: "XXX 0000", tags: [], level: "intro", fillsMajorSlot: false, fillsRequirement: true }, { interests: ["ai_data"] })
assert.ok(Number.isFinite(untagged.score) && !("interest" in untagged.components))

// 7. Same interest in Q1 and Q2 is rejected
assert.throws(() => rank(courses, { interests: ["ai_data"], lower_interest_topics: ["ai_data"] }))

// 8. Reasons only mention inputs that applied (STA 2090 does not fill a requirement)
assert.ok(!get(a, "STA 2090").reasons.includes("Counts toward a requirement"))

console.log("all checks passed\n")
for (const [name, s] of Object.entries(students)) {
  console.log(name)
  console.table(rank(courses, s).map(({ rank, code, score, reasons }) => ({ rank, code, score, reasons: reasons.join("; ") })))
}
