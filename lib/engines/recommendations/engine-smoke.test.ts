import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createAcademicEngine, toScoringFlags } from ".."
import { loadCatalog } from "../catalog/load"
import { rank } from "./scoring"

// Local synthetic smoke check only. It is not the owner-confirmed live handoff
// and does not implement persistence, dismissals, or a recommendation API.
describe("synthetic academic-engine and recommendation smoke check", () => {
  it("scores engine candidates while preserving unknown requirement flags", () => {
    const catalog = loadCatalog("data")
    const record = JSON.parse(readFileSync(join("lib", "engines", "examples", "record.json"), "utf8"))
    const engine = createAcademicEngine(catalog)
    const filtered = engine.filterCandidates(record, Object.keys(catalog.courses), { season: "spring", year: 2027 })
    expect(filtered.courses.find((course) => course.courseId === "bsc2010")?.decision).toBe("excluded")
    expect(filtered.courses.filter((course) => course.eligibility === "unknown").every((course) => course.decision !== "candidate")).toBe(true)
    const candidates = filtered.courses.filter((course) => course.decision === "candidate").slice(0, 10)
    expect(candidates.length).toBeGreaterThan(0)
    const flags = engine.requirementFlags(record, candidates.map((candidate) => candidate.input))
    const scored = rank(flags.courses.map((course) => ({
      code: course.code, level: "intro" as const, tags: [], // synthetic placeholders, not real course tags
      ...toScoringFlags(course),
    })), { major_scope: "outside_major" })
    expect(scored).toHaveLength(candidates.length)
    expect(scored.every((row) => Number.isFinite(row.score))).toBe(true)

    const unknown = engine.requirementFlags(record, ["CHI 1130"]).courses[0]
    expect(unknown.fillsRequirement).toBe("unknown")
    const unknownScore = rank([{ code: unknown.code, level: "intro", tags: [],
      ...toScoringFlags(unknown), fillsMajorSlot: null }], { major_scope: "outside_major" })[0]
    expect(unknownScore.components).not.toHaveProperty("req")
    expect(unknownScore.reasons).not.toContain("Matches your preference for courses outside your major requirements")
  }, 20000)
})
