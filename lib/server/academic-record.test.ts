import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createAcademicEngine } from "../engines"
import { loadCatalog } from "../engines/catalog/load"
import { currentTermFor, parseTerm, toAcademicRecord, type RecordInput } from "./academic-record"

const base: RecordInput = {
  userId: "user_test123",
  profile: { program_id: "ugeng-cps_bscs", catalog_year: "2026-2027", entry_term: "Fall 2024" },
  record: { version: 3, has_florida_aa: true, language_proficiency: null },
  attempts: [
    { id: "a1", course_code: "COP3502C", grade: "A", credits: 4, term: "Fall 2025", source: "uf", institution: null, status: "completed", original_label: null },
    { id: "a2", course_code: "COP3503C", grade: null, credits: "4.0", term: "Fall 2026", source: "uf", institution: null, status: "in_progress", original_label: null },
    { id: "a3", course_code: "ENC1101", grade: null, credits: 3, term: null, source: "transfer", institution: "Santa Fe College", status: "completed", original_label: "ENC1101 at SFC" },
  ],
  examCredits: [{ id: "e1", award_id: "ap-united-states-history-4-5", score: 5, course_codes: ["AMH2010", "AMH2020"], credits: 6 }],
  electiveCredits: [{ id: "l1", label: "SPN 1XXX elective", credits: 3, source: "transfer", institution: "Santa Fe College" }],
  now: new Date(2026, 9, 15),
}

describe("toAcademicRecord", () => {
  it("builds a record the engine's own schema accepts", () => {
    const r = toAcademicRecord(base)
    expect(r.recordVersion).toBe("3")
    expect(r.firstTerm).toEqual({ season: "fall", year: 2024 })
    expect(r.currentTerm).toEqual({ season: "fall", year: 2026 })
    expect(r.programs).toEqual([{ programId: "ugeng-cps_bscs" }])
    expect(r.exceptions).toEqual([])
  })

  it("converts course codes, terms and numbers to the engine's forms", () => {
    const [uf, inProgress, transfer] = toAcademicRecord(base).attempts
    expect(uf).toEqual({ attemptId: "a1", courseId: "cop3502c", status: "completed", grade: "A", credits: 4, source: "uf", term: { season: "fall", year: 2025 } })
    expect(inProgress).toEqual({ attemptId: "a2", courseId: "cop3503c", status: "in_progress", credits: 4, source: "uf", term: { season: "fall", year: 2026 } })
    expect(transfer).toEqual({ attemptId: "a3", courseId: "enc1101", status: "completed", credits: 3, source: "transfer", institution: "Santa Fe College", originalCode: "ENC1101 at SFC" })
  })

  it("passes exam and elective credit through", () => {
    const r = toAcademicRecord(base)
    expect(r.examCredits).toEqual([{ examCreditId: "e1", awardId: "ap-united-states-history-4-5", score: 5, courseIds: ["amh2010", "amh2020"], credits: 6 }])
    expect(r.electiveCredits).toEqual([{ entryId: "l1", label: "SPN 1XXX elective", credits: 3, source: "transfer", institution: "Santa Fe College" }])
  })

  it("leaves an unknown fact out instead of saying no", () => {
    expect(toAcademicRecord(base).facts).toEqual({ hasFloridaAA: true })
  })

  it("treats a student who never saved courses as version 0 with nothing known", () => {
    const r = toAcademicRecord({ ...base, record: null, attempts: [], examCredits: [], electiveCredits: [] })
    expect(r.recordVersion).toBe("0")
    expect(r.facts).toEqual({})
    expect(r.attempts).toEqual([])
  })

  it("never puts the Clerk id in the record", () => {
    const r = toAcademicRecord(base)
    expect(JSON.stringify(r)).not.toContain("user_test123")
    expect(r.recordId).toBe(toAcademicRecord(base).recordId)
    expect(r.recordId).not.toBe(toAcademicRecord({ ...base, userId: "user_other" }).recordId)
  })

  it("throws when the rows break the engine's rules", () => {
    const noInstitution = { ...base.attempts[2], institution: null }
    expect(() => toAcademicRecord({ ...base, attempts: [noInstitution] })).toThrow(/institution/)
    expect(() => toAcademicRecord({ ...base, profile: { ...base.profile, entry_term: "2024" } })).toThrow(/not a term/)
  })
})

describe("currentTermFor", () => {
  const fall25 = parseTerm("Fall 2025")

  it("uses the in-progress term when there is one", () => {
    expect(currentTermFor([{ status: "in_progress", term: parseTerm("Spring 2027") }], new Date(2026, 9, 1))).toEqual({ season: "spring", year: 2027 })
  })

  it("uses the calendar term otherwise", () => {
    expect(currentTermFor([], new Date(2026, 1, 1))).toEqual({ season: "spring", year: 2026 })
    expect(currentTermFor([], new Date(2026, 5, 1))).toEqual({ season: "summer", year: 2026 })
    expect(currentTermFor([], new Date(2026, 10, 1))).toEqual({ season: "fall", year: 2026 })
  })

  it("moves past a term the student already completed", () => {
    expect(currentTermFor([{ status: "completed", term: fall25 }], new Date(2025, 11, 20))).toEqual({ season: "spring", year: 2026 })
  })
})

describe("with Shaun's engine and the real catalog", () => {
  const engine = createAcademicEngine(loadCatalog(join(__dirname, "..", "..", "data")))
  const record = toAcademicRecord({
    ...base,
    attempts: [{ id: "a1", course_code: "MAC2311", grade: "A", credits: 4, term: "Fall 2025", source: "uf", institution: null, status: "completed", original_label: null }],
  })

  it("waives gen ed for a Florida AA", () => {
    const groups = engine.audit(record).programs[0].requirements
    const genEd = groups.filter((g) => /Gen Ed|Quest/.test(g.name))
    expect(genEd.length).toBeGreaterThan(0)
    for (const g of genEd) expect(g.status).toBe("satisfied")
  })

  it("lets a saved course unlock the next one", () => {
    expect(engine.eligibility(record, "MAC2312").status).toBe("eligible")
  })
})
