// Synthetic evaluation helper: invoke the real baseline, never live records.
import { readFileSync } from "node:fs"
// @ts-expect-error Node requires the extension when stripping types directly.
import { scoreCourse, SCORING_VERSION, type Tag } from "../lib/engines/recommendations/scoring.ts"

type Input = { interest_overlap: number; fills_requirement: number; level_match: number }
const rows: Input[] = JSON.parse(readFileSync(0, "utf8"))
if (!Array.isArray(rows)) throw new Error("Expected a synthetic feature array")
const scores = rows.map((row, index) => {
  const count = Math.round(row.interest_overlap * 10)
  if (!Number.isFinite(row.interest_overlap) || count < 0 || count > 10 || Math.abs(count / 10 - row.interest_overlap) > 1e-9 ||
      ![0, 1].includes(row.fills_requirement) || ![0, 1].includes(row.level_match)) throw new Error("Invalid synthetic features")
  const tags: Tag[] = Array.from({ length: 10 }, (_, i) => ({ interest: i < count ? `liked${i}` : `other${i}`, source: "subject_default" }))
  return scoreCourse({ code: `SYN${index}`, tags, level: row.level_match ? "intro" : "advanced",
    fillsRequirement: row.fills_requirement === 1, fillsMajorSlot: null },
  { interests: Array.from({ length: 10 }, (_, i) => `liked${i}`), course_level: "intro", exploration_mode: "settled" }).score
})
process.stdout.write(JSON.stringify({ scoring_version: SCORING_VERSION, scores }))
