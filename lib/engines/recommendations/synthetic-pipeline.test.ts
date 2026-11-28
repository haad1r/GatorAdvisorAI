import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createAcademicEngine } from ".."
import { loadCatalog } from "../catalog/load"
import { recommendSynthetic } from "./synthetic-pipeline"

describe("local synthetic recommendation pipeline", () => {
  it("filters using the engine, retains evidence, suppresses dismissals and avoids duplicate courses", () => {
    const catalog = loadCatalog("data")
    const engine = createAcademicEngine(catalog)
    const record = JSON.parse(readFileSync("lib/engines/examples/record.json", "utf8"))
    const term = { season: "spring" as const, year: 2027 }
    const all = Object.keys(catalog.courses)
    const eligible = engine.filterCandidates(record, all, term).courses.filter((course) => course.decision === "candidate" && course.courseId && /^[a-z]{3}[1-4]/.test(course.courseId))
    expect(eligible.length).toBeGreaterThanOrEqual(2)
    const dismissed = eligible[0].courseId!
    const kept = eligible[1].courseId!
    const result = recommendSynthetic(engine, record, [dismissed, kept, kept.toUpperCase(), "BSC 2010", "not a course"], term, {}, {}, [dismissed.toUpperCase()])
    expect(result.dismissed).toEqual([dismissed])
    expect(result.results.map((item) => item.courseId)).toEqual([kept])
    expect(result.results[0].eligibility).toMatch(/^eligible/)
    expect(result.results[0].offering).toBeTruthy()
    expect(result.decisions.find((item) => item.courseId === "bsc2010")?.decision).toBe("excluded")
    expect(result.decisions.find((item) => item.input === "not a course")?.decision).toBe("excluded")
    expect(result.versions).toEqual(engine.filterCandidates(record, [kept], term).versions)
  }, 20000)
})
