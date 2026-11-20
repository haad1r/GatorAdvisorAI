import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../catalog/load";
import {
  AcademicRecord,
  type AppliedCourse,
  AuditResult,
  EligibilityResult,
  Plan,
  type RequisiteEvaluation,
  type RequisiteNode,
  TrackingResult,
} from "../schemas";

/**
 * The examples in ../examples are hand-built to the contract, for the AI and
 * frontend teams to build against before the engines exist. This file makes
 * them trustworthy: each must pass its schema, and everything it claims about
 * the catalog or the record must be true of the real data.
 */

const ROOT = join(__dirname, "..", "..", "..");
const catalog = loadCatalog(join(ROOT, "data"));
const example = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "..", "examples", name), "utf8"));

const record = AcademicRecord.parse(example("record.json"));
const audits = ["audit.geology-minor.json", "audit.english-minor-needs-review.json"].map((f) =>
  AuditResult.parse(example(f)),
);
const eligibility = EligibilityResult.array().parse(example("eligibility.json"));
const tracking = TrackingResult.parse(example("tracking.psychology-bs.json"));
const plan = Plan.parse(example("plan.psychology-geology.json"));

const attempt = (id: string) => record.attempts.find((a) => a.attemptId === id);
const examCredit = (id: string) => record.examCredits.find((e) => e.examCreditId === id);

/** An applied course must be backed by the record entry it cites. */
function expectBackedByRecord(c: AppliedCourse, pending: boolean) {
  const a = attempt(c.evidenceId);
  if (a) {
    expect(a.courseId, c.evidenceId).toBe(c.courseId);
    expect(a.credits, c.evidenceId).toBe(c.credits);
    expect(a.grade, c.evidenceId).toBe(c.grade);
    expect(a.term, c.evidenceId).toEqual(c.term);
    expect(a.status, c.evidenceId).toBe(pending ? "in_progress" : "completed");
    expect(c.via).toBe(a.source);
    return;
  }
  const e = examCredit(c.evidenceId);
  expect(e, `evidence ${c.evidenceId} is in the record`).toBeDefined();
  expect(e!.courseIds).toContain(c.courseId);
  expect(c.via).toBe("exam");
  expect(pending).toBe(false);
}

/** UF grade points (catalog grading policy); null = not computed in the GPA. */
const GRADE_POINTS: Record<string, number | null> = {
  A: 4, "A-": 3.67, "B+": 3.33, B: 3, "B-": 2.67, "C+": 2.33, C: 2, "C-": 1.67,
  "D+": 1.33, D: 1, "D-": 0.67, E: 0, WF: 0, I: 0, NG: 0,
  S: null, U: null, W: null, H: null, "I*": null, "N*": null,
};

describe("record example", () => {
  it("names only real courses, programs and exam awards", () => {
    for (const a of record.attempts) expect(catalog.courses[a.courseId], a.courseId).toBeDefined();
    for (const p of record.programs) expect(catalog.programs[p.programId], p.programId).toBeDefined();
    for (const e of record.examCredits) {
      const award = catalog.examAwards[e.awardId];
      expect(award, e.awardId).toBeDefined();
      expect(e.courseIds).toEqual(award.courseIds);
      expect(e.credits).toBe(award.credits);
      expect(e.score).toBeGreaterThanOrEqual(award.minScore);
      expect(e.score).toBeLessThanOrEqual(award.maxScore);
    }
  });
});

describe("audit examples", () => {
  for (const audit of audits) {
    describe(audit.programId, () => {
      const program = catalog.programs[audit.programId];

      it("matches the program in the catalog", () => {
        expect(program).toBeDefined();
        expect(audit.programName).toBe(program.name);
        expect(audit.programKind).toBe(program.kind);
        expect(audit.programStatus).toBe(program.status);
        expect(audit.sources[0].fingerprint).toBe(program.source.fingerprint);
        expect(audit.sources[0].url).toBe(program.source.url);
        // Every group of the program is reported, in catalog order.
        expect(audit.requirements.map((r) => r.requirementKey)).toEqual(program.requirements.map((g) => g.key));
      });

      it("reports each requirement as the catalog defines it", () => {
        for (const r of audit.requirements) {
          const g = program.requirements.find((x) => x.key === r.requirementKey)!;
          expect(r.name).toBe(g.name);
          expect(r.section).toBe(g.section);
          expect(r.ruleType).toBe(g.ruleType);
          expect(r.required).toEqual({ credits: g.requiredCredits, courses: g.requiredCourseCount });
          for (const c of [...r.appliedCourses, ...r.pendingCourses, ...r.remainingOptions.courseIds.map((courseId) => ({ courseId }))])
            expect(g.eligibleCourseIds, `${c.courseId} is eligible for ${g.key}`).toContain(c.courseId);
        }
      });

      it("cites real record entries and counts each course once", () => {
        const counted = new Map<string, string>();
        for (const r of audit.requirements) {
          for (const c of r.appliedCourses) expectBackedByRecord(c, false);
          for (const c of r.pendingCourses) expectBackedByRecord(c, true);
          if (!r.countsTowardDegree) continue;
          for (const c of [...r.appliedCourses, ...r.pendingCourses]) {
            expect(counted.get(c.courseId), `${c.courseId} counted twice`).toBeUndefined();
            counted.set(c.courseId, r.requirementKey);
          }
        }
        for (const c of audit.unappliedCourses) {
          expectBackedByRecord(c, false);
          expect(counted.has(c.courseId), `${c.courseId} is both applied and unapplied`).toBe(false);
        }
      });

      it("computes the UF cumulative GPA by the grading policy", () => {
        const gpa = audit.gpa.find((g) => g.kind === "uf_cumulative")!;
        let points = 0;
        let hours = 0;
        const used: string[] = [];
        for (const a of record.attempts) {
          // UF attempts only (transfer grades are never averaged in); every
          // attempt of a repeat counts.
          if (a.source !== "uf" || a.status !== "completed" || !a.grade) continue;
          const gp = GRADE_POINTS[a.grade];
          if (gp === null) continue;
          points += gp * a.credits;
          hours += a.credits;
          used.push(a.attemptId);
        }
        expect(gpa.gradePoints).toBeCloseTo(points, 9);
        expect(gpa.gpaHours).toBe(hours);
        expect(gpa.attemptIds).toEqual(used);
        expect(gpa.value).toBe(Math.round((points / hours) * 100) / 100);
      });
    });
  }
});

/** The evaluated tree must mirror the catalog's tree node for node. */
function expectSameShape(ev: RequisiteEvaluation, node: RequisiteNode) {
  expect(ev.type).toBe(node.type);
  if (node.type === "and" || node.type === "or") {
    expect(ev.children?.length).toBe(node.items.length);
    node.items.forEach((child, i) => expectSameShape(ev.children![i], child));
  } else {
    expect(ev.children).toBeUndefined();
  }
}

describe("eligibility examples", () => {
  it("covers every eligibility status", () => {
    expect(new Set(eligibility.map((e) => e.status))).toEqual(
      new Set(["eligible", "eligible_pending", "not_eligible", "unknown"]),
    );
  });

  for (const e of eligibility) {
    it(`${e.courseId}: evaluates the catalog's own prerequisite`, () => {
      const course = catalog.courses[e.courseId];
      expect(course).toBeDefined();
      expect(e.sources[0].excerpt).toBe(course.prerequisite!.rawText);
      expectSameShape(e.prerequisite!, course.prerequisite!.tree!);
      expect(e.corequisite === null).toBe(course.corequisite === null);
      for (const id of collectEvidence(e.prerequisite!)) expect(attempt(id), id).toBeDefined();
    });
  }
});

function collectEvidence(ev: RequisiteEvaluation): string[] {
  return [...(ev.evidenceIds ?? []), ...(ev.children ?? []).flatMap(collectEvidence)];
}

describe("tracking example", () => {
  it("reports the program's own milestones, in order", () => {
    const program = catalog.programs[tracking.programId];
    expect(tracking.milestones.map((m) => [m.semester, m.kind, m.rawText])).toEqual(
      program.milestones.map((m) => [m.semester, m.kind, m.rawText]),
    );
  });

  it("counts enrolled fall/spring semesters from the record (summers excluded)", () => {
    // fall 2025, spring 2026, fall 2026
    expect(record.firstTerm).toEqual({ season: "fall", year: 2025 });
    expect(record.currentTerm).toEqual({ season: "fall", year: 2026 });
    expect(tracking.currentSemester).toBe(3);
  });
});

describe("plan example", () => {
  it("fills real slots with real courses", () => {
    const slots = new Map(plan.slots.map((s) => [s.slotId, s]));
    for (const t of plan.terms)
      for (const c of t.courses) {
        if (c.courseId === null) {
          // A placeholder reserves hours for a prose slot, which lists no course.
          expect(c.why).toBe("placeholder");
          for (const id of c.slotIds) expect(slots.get(id)?.courseIds, id).toEqual([]);
          continue;
        }
        expect(catalog.courses[c.courseId]).toBeDefined();
        for (const slot of c.slotIds) {
          const [programId, rest] = slot.split("/");
          const key = rest.split("#")[0];
          const group = catalog.programs[programId].requirements.find((g) => g.key === key);
          expect(group?.eligibleCourseIds, slot).toContain(c.courseId);
          expect(slots.get(slot)?.courseIds, slot).toContain(c.courseId);
        }
      }
  });

  it("keeps the student's lock where it was put", () => {
    const sta = plan.terms.flatMap((t) => t.courses.map((c) => ({ ...c, term: t.term }))).find((c) => c.courseId === "sta3024")!;
    expect([sta.locked, sta.term]).toEqual([true, { season: "spring", year: 2027 }]);
  });

  it('marks an offering "confirmed" only when the published schedule has it', () => {
    const spring2027 = readFileSync(join(ROOT, "data", "soc", "sections", "2271.csv"), "utf8");
    for (const t of plan.terms)
      for (const c of t.courses)
        if (c.offering === "confirmed") {
          expect(t.term).toEqual({ season: "spring", year: 2027 });
          expect(spring2027).toMatch(new RegExp(`^2271,\\d+,${c.courseId},`, "m"));
        }
  });
});
