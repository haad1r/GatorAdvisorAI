import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../catalog/load";
import { generatePlan } from "../planner";
import { AcademicRecord, type Plan } from "../schemas";
import { auditStudent } from "../student";
import { draftOf, validatePlan } from "../validate";

/**
 * Every program in the catalog, for an admitted freshman who hasn't started
 * (Summer 2026 now, first term Fall 2026), planned through Spring 2030 at 18
 * credits. Proves the audit and planner run on every requirement shape in
 * the data, and that a plan the planner calls feasible is one the validator
 * accepts. The counts are the coverage published in README.md; the floor
 * catches regressions.
 */

const catalog = loadCatalog(join(__dirname, "..", "..", "..", "data"));
const freshman = (programId: string) =>
  AcademicRecord.parse({
    contractVersion: "0.2.0",
    recordId: `freshman-${programId}`,
    recordVersion: "1",
    catalogYear: "2026-2027",
    currentTerm: { season: "summer", year: 2026 },
    firstTerm: { season: "fall", year: 2026 },
    programs: [{ programId }],
    attempts: [],
    examCredits: [],
    electiveCredits: [],
    exceptions: [],
    facts: {},
  });

describe("every program", () => {
  const plans = new Map<string, Plan>();
  for (const p of Object.values(catalog.programs))
    plans.set(p.id, generatePlan(catalog, freshman(p.id), { targetTerm: { season: "spring", year: 2030 }, creditCap: 18 }));

  it("audits and plans without failing", () => {
    expect(plans.size).toBe(Object.keys(catalog.programs).length);
    for (const p of Object.values(catalog.programs)) expect(() => auditStudent(catalog, freshman(p.id))).not.toThrow();
  });

  it("a feasible plan is one the validator accepts", () => {
    for (const [id, plan] of plans)
      if (plan.status === "feasible") expect(validatePlan(catalog, freshman(id), draftOf(plan)).valid, id).toBe(true);
  });

  it("a program under review never plans as feasible without saying so", () => {
    for (const [id, plan] of plans)
      if (catalog.programs[id].status === "needs_review") expect(plan.assumptions.map((a) => a.code), id).toContain("program_needs_review");
  });

  it("plans most programs end to end (coverage floor)", () => {
    const byKind = (kind: string) => [...plans].filter(([id]) => catalog.programs[id].kind === kind);
    const feasible = (xs: [string, Plan][]) => xs.filter(([, p]) => p.status === "feasible").length;
    expect(feasible([...plans])).toBeGreaterThanOrEqual(310);
    expect(feasible(byKind("major"))).toBeGreaterThanOrEqual(110);
  });

  it("is deterministic", () => {
    for (const id of ["ugact-act_bsac", "uglas-psy_bs01", "ugagl-agl_uct14"])
      expect(generatePlan(catalog, freshman(id), { targetTerm: { season: "spring", year: 2030 }, creditCap: 18 })).toEqual(plans.get(id));
  });
});
