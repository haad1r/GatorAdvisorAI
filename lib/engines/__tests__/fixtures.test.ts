import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAcademicEngine } from "..";
import { loadCatalog } from "../catalog/load";
import { type Plan, type PlanOptions, type Term, compareTerms, termCode, toCourseId } from "../schemas";

/**
 * Issue #8 step 10: manually reviewed fixtures across three program
 * structures. The expected values in examples/fixtures/*.expected.json were
 * worked by hand from the catalog data (the arithmetic is in
 * examples/fixtures/README.md); this test checks the engine against them.
 *
 *   001  Psychology BS + Geology minor: tracking-heavy major, a minor
 *   002  Accounting BSAc: plan-derived spine, gen ed waived by an AA,
 *        transfer credit, a missed tracking milestone (impossible plan)
 *   003  A certificate: repeat in progress, advisor substitution, locks,
 *        a locked course the schedule doesn't offer, a credit cap too small
 */

const DIR = join(__dirname, "..", "examples", "fixtures");
const catalog = loadCatalog(join(__dirname, "..", "..", "..", "data"));
const engine = createAcademicEngine(catalog);
const read = (f: string): unknown => JSON.parse(readFileSync(join(DIR, f), "utf8"));

/** The shape of examples/fixtures/*.expected.json. */
type RequirementCase = { status: string; applied: string[]; pending: string[]; remainingTotal?: number; reasonCodes?: string[] };
type TrackingCase = { currentSemester: number; status: string; milestones: Record<string, string>; nextDeadline: unknown };
type PlanCase = {
  name: string;
  options?: PlanOptions;
  regenerateFrom?: number;
  changes?: Partial<PlanOptions>;
  status: string;
  blockerCodes?: string[];
  blockerCount?: number;
  blockerCodesInclude?: string[];
  plannedCredits?: number;
  earliest?: Record<string, Term>;
  notBefore?: Record<string, Term>;
  terms?: Record<string, string[]>;
  termCredits?: Record<string, number>;
  slots?: string[];
  locked?: string[];
  unplaced?: string[];
};
type Expected = {
  record: string;
  summary: string;
  audit: Record<string, { overallStatus: string; totals: Record<string, number | null>; requirements: Record<string, RequirementCase>; unapplied?: string[] }>;
  student: {
    credits: { earned: number; inProgress: number };
    gpa: { uf_cumulative: number | null; gradePoints?: number; gpaHours?: number };
    sharedCourses?: string[];
    sharedCoursesInclude?: string[];
    unknownKeys?: (string | null)[];
  };
  tracking: { untracked?: string[] } & Record<string, TrackingCase | string[] | undefined>;
  eligibility: { course: string; term: Term; status: string; taken: string; offering: string }[];
  plans: PlanCase[];
};

for (const name of ["student-001", "student-002", "student-003"]) {
  const expected = read(`${name}.expected.json`) as Expected;
  const record = read(expected.record);

  describe(`${name}: ${expected.summary.split(":")[0]}`, () => {
    const audit = engine.audit(record);

    it("audit", () => {
      for (const [pid, want] of Object.entries(expected.audit)) {
        const a = audit.programs.find((p) => p.programId === pid)!;
        expect(a.overallStatus, pid).toBe(want.overallStatus);
        expect({
          required: a.totals.required.credits,
          completed: a.totals.completed.credits,
          inProgress: a.totals.inProgress.credits,
          remaining: a.totals.remaining.credits,
        }).toEqual(want.totals);
        for (const [key, w] of Object.entries(want.requirements)) {
          const r = a.requirements.find((x) => x.requirementKey === key)!;
          expect(r.status, key).toBe(w.status);
          expect(r.appliedCourses.map((c) => c.courseId), key).toEqual(w.applied);
          expect(r.pendingCourses.map((c) => c.courseId), key).toEqual(w.pending);
          if (w.remainingTotal !== undefined) expect(r.remainingOptions.total, key).toBe(w.remainingTotal);
          for (const code of w.reasonCodes ?? []) expect(r.reasons.map((x) => x.code), key).toContain(code);
        }
        if (want.unapplied) expect(a.unappliedCourses.map((c) => c.courseId).sort()).toEqual([...want.unapplied].sort());
      }
    });

    it("credits, GPA, shared courses, unknowns", () => {
      const s = expected.student;
      expect(audit.credits).toEqual(s.credits);
      const gpa = audit.gpa.find((g) => g.kind === "uf_cumulative")!;
      expect(gpa.value).toBe(s.gpa.uf_cumulative);
      if (s.gpa.gradePoints !== undefined) {
        expect(gpa.gradePoints).toBeCloseTo(s.gpa.gradePoints, 9);
        expect(gpa.gpaHours).toBe(s.gpa.gpaHours);
      }
      if (s.sharedCourses) expect(audit.sharedCourses.map((c) => c.courseId)).toEqual(s.sharedCourses);
      for (const id of s.sharedCoursesInclude ?? []) expect(audit.sharedCourses.map((c) => c.courseId)).toContain(id);
      if (s.unknownKeys) expect(audit.unknowns.map((u) => u.requirementKey)).toEqual(s.unknownKeys);
    });

    it("tracking", () => {
      const t = engine.tracking(record);
      const { untracked, ...programs } = expected.tracking;
      if (untracked) expect(t.untracked.map((u) => u.programId)).toEqual(untracked);
      for (const [pid, w] of Object.entries(programs)) {
        const want = w as TrackingCase;
        const p = t.programs.find((x) => x.programId === pid)!;
        expect(p.currentSemester).toBe(want.currentSemester);
        expect(p.status).toBe(want.status);
        for (const [i, status] of Object.entries(want.milestones)) expect(p.milestones[Number(i)].status, `milestone ${i}: ${p.milestones[Number(i)].rawText}`).toBe(status);
        expect(p.nextDeadline).toEqual(want.nextDeadline);
      }
    });

    it("eligibility", () => {
      for (const w of expected.eligibility) {
        const e = engine.eligibility(record, w.course, w.term);
        expect([e.status, e.taken.status, e.offering.status], w.course).toEqual([w.status, w.taken, w.offering]);
      }
    });

    describe("plans", () => {
      const plans: Plan[] = [];
      expected.plans.forEach((w, i) => {
        it(w.name, () => {
          const plan =
            w.regenerateFrom !== undefined
              ? engine.regeneratePlan(record, plans[w.regenerateFrom], w.changes)
              : engine.generatePlan(record, w.options!);
          plans[i] = plan;
          expect(plan.status, JSON.stringify(plan.blockers.map((b) => b.message))).toBe(w.status);
          const codes = plan.blockers.map((b) => b.code);
          if (w.blockerCodes) expect([...new Set(codes)]).toEqual(w.blockerCodes);
          if (w.blockerCount !== undefined) expect(codes.length, JSON.stringify(plan.blockers.map((b) => b.message))).toBe(w.blockerCount);
          for (const c of w.blockerCodesInclude ?? []) expect(codes).toContain(c);
          if (w.plannedCredits !== undefined) expect(plan.totals.planned).toBe(w.plannedCredits);
          const termOf = (id: string): Term | undefined => plan.terms.find((t) => t.courses.some((c) => c.courseId === id))?.term;
          for (const [id, term] of Object.entries(w.earliest ?? {})) expect(termOf(id), id).toEqual(term);
          for (const [id, term] of Object.entries(w.notBefore ?? {})) {
            const t = termOf(id);
            expect(t, `${id} is planned`).toBeDefined();
            expect(compareTerms(t!, term), `${id} not before ${term.season} ${term.year}`).toBeGreaterThanOrEqual(0);
          }
          for (const [code, ids] of Object.entries(w.terms ?? {})) {
            const t = plan.terms.find((x) => termCode(x.term) === code)!;
            expect(t.courses.map((c) => c.courseId).sort()).toEqual([...ids].sort());
          }
          for (const [code, credits] of Object.entries(w.termCredits ?? {}))
            expect(plan.terms.find((x) => termCode(x.term) === code)!.credits).toBe(credits);
          if (w.slots) expect(plan.slots.map((s) => s.slotId)).toEqual(w.slots);
          for (const id of w.locked ?? [])
            expect(plan.terms.flatMap((t) => t.courses).find((c) => c.courseId === toCourseId(id))?.locked, id).toBe(true);
          for (const id of w.unplaced ?? []) expect(plan.unplacedCourses.map((u) => u.courseId)).toContain(id);

          // Whatever the plan says, the validator must agree with it.
          const check = engine.validatePlan(record, plan);
          if (plan.status === "feasible") expect(check.valid, JSON.stringify(check.issues.filter((x) => x.severity === "error"))).toBe(true);
          for (const t of plan.terms)
            for (const c of t.courses)
              if (c.courseId && !c.locked)
                expect(check.issues.filter((x) => x.severity === "error" && x.code === "prerequisite_chain" && x.courseIds?.includes(c.courseId!))).toEqual([]);
        });
      });
    });
  });
}
