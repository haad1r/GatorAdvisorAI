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
    expect(["confirmed_course_offering", "historical_course_offering"]).toContain(result.results[0].offeringState)
    expect(["eligible_for_target_term", "conditional_for_target_term"]).toContain(result.results[0].eligibilityState)
    expect(result.decisions.find((item) => item.courseId === "bsc2010")?.decision).toBe("excluded")
    expect(result.decisions.find((item) => item.input === "not a course")?.decision).toBe("excluded")
    expect(result.versions).toEqual(engine.filterCandidates(record, [kept], term).versions)
  }, 20000)
  it("fails closed when academic evidence versions differ", () => {
    const engine = createAcademicEngine(loadCatalog("data"))
    const record = JSON.parse(readFileSync("lib/engines/examples/record.json", "utf8"))
    const inconsistent = { ...engine, requirementFlags: (...args: Parameters<typeof engine.requirementFlags>) => {
      const result = engine.requirementFlags(...args)
      return { ...result, versions: { ...result.versions, recordVersion: "changed" } }
    } }
    expect(() => recommendSynthetic(inconsistent, record, ["BSC 2010"], { season: "spring", year: 2027 }, {}, {})).toThrow(/evidence changed/)
  }, 20000)
})
