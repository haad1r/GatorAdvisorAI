import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAcademicEngine } from "..";
import { loadCatalog } from "../catalog/load";
import { previousTerm, recordAtStartOf } from "../hypothetical";
import { regenerationOptions } from "../planner";
import { AcademicRecord, Plan, type Term, compareTerms } from "../schemas";

/**
 * The planner, plan validation and what-if plans, beyond the hand-checked
 * fixtures (fixtures.test.ts) and the whole-catalog sweep (coverage.test.ts).
 */

const catalog = loadCatalog(join(__dirname, "..", "..", "..", "data"));
const engine = createAcademicEngine(catalog);
const read = (p: string): unknown => JSON.parse(readFileSync(join(__dirname, "..", "examples", p), "utf8"));
const psy = read("record.json"); // Psychology BS + Geology minor, Fall 2026
const acc = read("fixtures/student-002.record.json"); // Accounting transfer
const cert = read("fixtures/student-003.record.json"); // certificate
const SPRING_2027: Term = { season: "spring", year: 2027 };
const FALL_2027: Term = { season: "fall", year: 2027 };

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}
const issues = (check: { issues: { severity: string; code: string; courseIds?: string[] }[] }, code: string) =>
  check.issues.filter((i) => i.code === code);

describe("hypothetical records", () => {
  const record = AcademicRecord.parse(psy);
  it("are the record itself for the next term", () => {
    expect(recordAtStartOf(record, [], SPRING_2027)).toBe(record);
  });

  it("count current and earlier planned courses as passed, never in the UF GPA", () => {
    const r = recordAtStartOf(record, [{ courseId: "gly3163", term: SPRING_2027, credits: 3 }], FALL_2027);
    expect(r.currentTerm).toEqual(previousTerm(FALL_2027)); // Summer 2027
    expect(r.attempts.filter((a) => a.status === "in_progress")).toEqual([]);
    const planned = r.attempts.find((a) => a.courseId === "gly3163")!;
    expect([planned.status, planned.source, planned.grade]).toEqual(["completed", "transfer", "A"]);
    // The saved record is untouched.
    expect(record.attempts.some((a) => a.courseId === "gly3163")).toBe(false);
  });
});

describe("validatePlan", () => {
  it("catches what can't work, naming the term and course", () => {
    const check = engine.validatePlan(acc, {
      creditCap: 8,
      terms: [
        { term: { season: "summer", year: 2026 }, courses: ["GEB 2216"] }, // not after the current term
        { term: SPRING_2027, courses: ["MAR 3023", "GEB 3373", "ACG 2021", "XYZ 1234", "GLY 3105C"] },
        { term: FALL_2027, courses: ["mar3023"] },
      ],
    });
    expect(check.valid).toBe(false);
    expect(issues(check, "term_out_of_range").length).toBeGreaterThan(0);
    // GEB 3373 needs MAR 3023 before it, not in the same term.
    expect(issues(check, "prerequisite_chain").flatMap((i) => i.courseIds)).toContain("geb3373");
    expect(issues(check, "unknown_course").length).toBe(1);
    expect(issues(check, "duplicate_course").flatMap((i) => i.courseIds)).toEqual(["mar3023"]);
    expect(issues(check, "already_held").flatMap((i) => i.courseIds)).toEqual(["acg2021"]); // a repeat: a warning
    expect(issues(check, "credit_cap").length).toBe(1); // 4+4+4+4 > 8
    expect(issues(check, "not_offered").flatMap((i) => i.courseIds)).toContain("gly3105c"); // fall-only
    // The missed semester-4 milestone, and requirements left open.
    expect(issues(check, "deadline_unreachable").length).toBeGreaterThan(0);
    expect(issues(check, "requirements_remaining").length).toBeGreaterThan(0);
  });

  it("an empty plan leaves every open requirement open", () => {
    const check = engine.validatePlan(cert, { terms: [] });
    expect(check.programsAfter).toEqual([
      expect.objectContaining({ programId: "ugagl-agl_uct14", overallStatus: "not_satisfied", remainingCredits: 4 }),
    ]);
  });

  it("the certificate finishes with the two courses left", () => {
    const check = engine.validatePlan(cert, { terms: [{ term: SPRING_2027, courses: ["ALS 4162", "ENY 4905"] }] });
    expect(check.valid).toBe(true);
    expect(check.programsAfter[0].overallStatus).toBe("satisfied");
    // ENY 4905's "basic course in selected specialization" isn't parsed: a warning, never a pass.
    expect(check.issues.filter((i) => i.severity === "warning").map((i) => i.code)).toContain("requisite_unparsed");
  });
});

describe("generatePlan", () => {
  const options = { targetTerm: { season: "spring", year: 2029 } as Term };
  const plan = engine.generatePlan(psy, options);

  it("is a valid, deterministic plan", () => {
    expect(Plan.safeParse(plan).success).toBe(true);
    expect(engine.generatePlan(psy, options)).toEqual(plan);
    expect(plan.status).toBe("feasible");
    expect(engine.validatePlan(psy, plan).valid).toBe(true);
  });

  it("explains every course: a slot it fills, or why it is there", () => {
    const slots = new Set(plan.slots.map((s) => s.slotId));
    for (const c of plan.terms.flatMap((t) => t.courses)) {
      if (c.why === "requirement") expect(c.slotIds.every((id) => slots.has(id)), c.label).toBe(true);
      else expect(c.notes.length + c.slotIds.length, c.label).toBeGreaterThan(0);
    }
  });

  it("respects caps, offerings and the record", () => {
    for (const t of plan.terms) {
      expect(t.credits).toBeLessThanOrEqual(t.creditCap);
      for (const c of t.courses) if (c.courseId) expect(engine.eligibility(psy, c.courseId, t.term).offering.status, c.label).not.toBe("not_scheduled");
    }
    // Nothing the student already holds is planned again.
    const held = ["psy2012", "bsc2010", "gly3202c", "mac2311"];
    expect(plan.terms.flatMap((t) => t.courses.map((c) => c.courseId)).filter((id) => held.includes(id!))).toEqual([]);
    expect(plan.totals).toEqual(expect.objectContaining({ earned: 31, inProgress: 12 }));
  });

  it("states what it assumes", () => {
    const codes = plan.assumptions.map((a) => a.code);
    expect(codes).toContain("in_progress_pending"); // current courses assumed passed
    expect(codes).toContain("offering_unconfirmed"); // future terms from past semesters
    expect(codes).toContain("missing_input"); // the language requirement may be waived
  });

  it("refuses options that make no sense", () => {
    expect(() => engine.generatePlan(psy, { targetTerm: { season: "fall", year: 2026 } })).toThrow(RangeError);
    expect(() => engine.generatePlan(psy, { targetTerm: SPRING_2027, startTerm: { season: "fall", year: 2026 } })).toThrow(/after the record's currentTerm/);
  });

  it("follows the caller's preferences among a slot's options", () => {
    const gened = plan.slots.find((s) => s.kind === "credits" && s.courseIds.length > 12 && s.section === "geneed")!;
    const pick = gened.courseIds.find((id) => !plan.terms.some((t) => t.courses.some((c) => c.courseId === id)) && catalog.courses[id] && !catalog.courses[id].prerequisite)!;
    const preferred = engine.generatePlan(psy, { ...options, prefer: [pick] });
    expect(preferred.terms.flatMap((t) => t.courses).find((c) => c.courseId === pick)?.slotIds).toContain(gened.slotId);
  });
});

describe("locks survive regeneration", () => {
  it("keeps locked courses and locked terms when the options change", () => {
    const first = engine.generatePlan(psy, { targetTerm: { season: "spring", year: 2029 }, locks: [{ course: "GLY 3163", term: FALL_2027 }] });
    // The student locks the whole Spring 2027 term as planned.
    const locked: Plan = { ...first, terms: first.terms.map((t) => (compareTerms(t.term, SPRING_2027) === 0 ? { ...t, locked: true } : t)) };
    const again = engine.regeneratePlan(psy, locked, { creditCap: 12 });
    const ids = (p: Plan, t: Term) => p.terms.find((x) => compareTerms(x.term, t) === 0)!.courses.map((c) => c.courseId).sort();
    expect(ids(again, SPRING_2027)).toEqual(ids(first, SPRING_2027));
    expect(ids(again, FALL_2027)).toContain("gly3163");
    expect(again.terms.find((t) => compareTerms(t.term, SPRING_2027) === 0)!.locked).toBe(true);
    expect(regenerationOptions(locked).locks!.map((l) => l.course)).toContain("gly3163");
  });

  it("a lock that breaks a rule stays, and blocks the plan with locked_conflict", () => {
    // TAX 4001 needs ACG 4111 and ACG 4341 first: it can't be taken in Spring 2027.
    const plan = engine.generatePlan(acc, { targetTerm: { season: "fall", year: 2028 }, creditCap: 18, locks: [{ course: "TAX 4001", term: SPRING_2027 }] });
    const tax = plan.terms[0].courses.find((c) => c.courseId === "tax4001")!;
    expect(tax.locked).toBe(true);
    expect(plan.blockers.map((b) => b.code)).toContain("locked_conflict");
  });
});

describe("whatIf with plans", () => {
  it("plans the copy, diffs the plans, and leaves the saved record and plan untouched", () => {
    const saved = deepFreeze(engine.generatePlan(cert, { targetTerm: SPRING_2027 }));
    const savedJson = JSON.stringify(saved);
    const record = deepFreeze(structuredClone(cert));
    const recordJson = JSON.stringify(record);
    const w = engine.whatIf(record, { add: ["ugagl-agl_uct06"] }, { options: saved.options, saved });
    expect(w.plans!.baseline).toEqual(saved); // a validated copy of the saved plan
    expect(w.plans!.scenario.basis).toBe("what_if");
    expect(w.plans!.scenario.programIds).toEqual(["ugagl-agl_uct14", "ugagl-agl_uct06"]);
    expect(w.plans!.diff.plannedCredits.baseline).toBe(saved.totals.planned);
    expect(w.plans!.diff.coursesAdded.length).toBeGreaterThan(0);
    expect(w.plans!.diff.coursesDropped).toEqual([]);
    expect(JSON.stringify(saved)).toBe(savedJson);
    expect(JSON.stringify(record)).toBe(recordJson);
  });
});

describe("the plan example", () => {
  it("is what the planner produces", () => {
    const expected = Plan.parse(read("plan.psychology-geology.json"));
    expect(engine.generatePlan(psy, expected.options)).toEqual(expected);
  });
});
