// Synthetic performance check only; does not measure recommendation quality.
// Run: node scripts/benchmark-recommendations.ts [pool-size]
// @ts-expect-error Node requires the .ts extension for direct execution.
import { rank, type Course } from "../lib/engines/recommendations/scoring.ts"

const size = Number(process.argv[2] ?? 10000)
if (!Number.isSafeInteger(size) || size < 1 || size > 20000) throw new Error("pool-size must be an integer from 1 to 20000")
const courses: Course[] = Array.from({ length: size }, (_, i) => ({
  code: `C${String(i).padStart(5, "0")}`,
  level: i % 2 ? "intro" : "advanced",
  fillsMajorSlot: i % 7 === 0,
  fillsRequirement: i % 3 === 0,
  tags: [{ interest: `topic${i % 22}`, source: "subject_default" }],
}))
const start = performance.now()
const result = rank(courses, {})
console.log(JSON.stringify({ fixture: "synthetic", poolSize: size, profile: "cold-start", returned: result.length, elapsedMs: Math.round(performance.now() - start) }))
