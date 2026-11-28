import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { adaptSyntheticAuditRequirement } from "./synthetic-audit-adapter"
import { explainSyntheticRequirement } from "./synthetic-requirement"

const audit = JSON.parse(readFileSync("lib/engines/examples/audit.geology-minor.json", "utf8"))

describe("synthetic academic audit adapter", () => {
  it("extracts one validated engine requirement and keeps sources unverified", async () => {
    const result = adaptSyntheticAuditRequirement(audit, "requirements")
    expect(result.fact).toMatchObject({ requirementId: "requirements", status: "in_progress", completedCredits: 5, requiredCredits: 8, sourceId: null })
    expect(result.versions.recordVersion).toBe(audit.versions.recordVersion)
    expect(result.sourceReferences.length).toBeGreaterThan(0)
    const answer = await explainSyntheticRequirement({ fact: result.fact, retrievedSourceIds: [] }, async () => result.fact)
    expect(answer.kind).toBe("engine_fallback")
    expect(answer.sourceId).toBeNull()
  })
  it("rejects nonexistent requirements and malformed audit output", () => {
    expect(() => adaptSyntheticAuditRequirement(audit, "not-a-requirement")).toThrow()
    expect(() => adaptSyntheticAuditRequirement({ ...audit, versions: {} }, "requirements")).toThrow()
  })
})
