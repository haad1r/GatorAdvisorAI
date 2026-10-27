import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditProgram } from "../audit";
import { evaluateGroup } from "../audit/group";
import { holdingsOf } from "../audit/held";
import { groupShape, spendOrder } from "../audit/shape";
import { loadCatalog } from "../catalog/load";
import { CourseHistory } from "../history";
import { AcademicRecord, AuditResult, type RequirementGroup } from "../schemas";

const catalog = loadCatalog(join(__dirname, "..", "..", "..", "data"));
const example = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "..", "examples", name), "utf8"));
const record = AcademicRecord.parse(example("record.json"));

const withRecord = (edit: (r: AcademicRecord) => void): AcademicRecord => {
  const r = structuredClone(record);
  edit(r);
  return AcademicRecord.parse(r);
};

const GEOLOGY = "uglas-gly_umn";
const requirement = (audit: AuditResult, key: string) => audit.requirements.find((r) => r.requirementKey === key)!;

describe("audit engine reproduces the hand-built examples", () => {
  for (const file of ["audit.geology-minor.json", "audit.english-minor-needs-review.json"]) {
    const expected = AuditResult.parse(example(file));
    it(`${expected.programId}: ${expected.overallStatus}`, () => {
      const got = auditProgram(catalog, record, expected.programId);
      expect(got.overallStatus).toBe(expected.overallStatus);
      expect(got.totals).toEqual(expected.totals);
      expect(got.unappliedCourses).toEqual(expected.unappliedCourses);
      expect(got.versions).toEqual(expected.versions);
      const gpa = got.gpa[0];
      expect(gpa.value).toBe(expected.gpa[0].value);
      expect(gpa.gradePoints).toBeCloseTo(expected.gpa[0].gradePoints, 9);
      expect(gpa.attemptIds).toEqual(expected.gpa[0].attemptIds);
      for (const want of expected.requirements) {
        const r = requirement(got, want.requirementKey);
        expect(r.status, want.requirementKey).toBe(want.status);
        expect(r.appliedCourses, want.requirementKey).toEqual(want.appliedCourses);
        expect(r.pendingCourses, want.requirementKey).toEqual(want.pendingCourses);
        expect(r.remainingOptions.courseIds, want.requirementKey).toEqual(want.remainingOptions.courseIds);
        expect(r.remainingOptions.total, want.requirementKey).toBe(want.remainingOptions.total);
        // The engine may say more than the hand-written example, never less.
        for (const code of want.reasons.map((x) => x.code))
          expect(r.reasons.map((x) => x.code), want.requirementKey).toContain(code);
      }
    });
  }
});

describe("counting", () => {
  it("a course counts toward one requirement of the major; the specific row gets it first", () => {
    const audit = auditProgram(catalog, record, GEOLOGY);
    expect(requirement(audit, "requirements").pendingCourses.map((c) => c.courseId)).toContain("gly3202c");
    const pool = requirement(audit, "elective-gly-courses-3000-4000-level-6");
    expect(pool.pendingCourses.map((c) => c.courseId)).not.toContain("gly3202c");
    expect(pool.reasons.find((x) => x.code === "counted_elsewhere")?.courseIds).toEqual(["gly3202c"]);
  });

  it("an allow_overlap exception lets a course count in both", () => {
    const r = withRecord((x) =>
      x.exceptions.push({
        kind: "allow_overlap",
        exceptionId: "x-overlap",
        courseId: "gly3202c",
        requirements: [
          { programId: GEOLOGY, requirementKey: "requirements" },
          { programId: GEOLOGY, requirementKey: "elective-gly-courses-3000-4000-level-6" },
        ],
        note: "Approved by the department.",
      }),
    );
    const pool = requirement(auditProgram(catalog, r, GEOLOGY), "elective-gly-courses-3000-4000-level-6");
    expect(pool.pendingCourses.map((c) => c.courseId).sort()).toEqual(["gly3202c", "gly4155c"]);
    expect(pool.status).toBe("in_progress");
    expect(pool.reasons.map((x) => x.code)).toContain("overlap_allowed");
  });

  it("gen ed may share a course with the major", () => {
    const audit = auditProgram(catalog, record, "uglas-psy_bs01");
    const intro = requirement(audit, "introductory-level");
    const social = requirement(audit, "gened-social");
    expect(intro.appliedCourses.map((c) => c.courseId)).toEqual(["psy2012"]);
    expect(social.appliedCourses.map((c) => c.courseId)).toContain("psy2012");
  });

  it("a slot with prose alternatives is unknown, never unmet", () => {
    const audit = auditProgram(catalog, record, "uglas-psy_bs01");
    const electives = requirement(audit, "psychology-behavioral-and-cognitive-neuroscience-major-electives");
    expect(electives.status).toBe("unknown");
    expect(electives.remainingOptions.openSlots.length).toBeGreaterThan(0);
  });

  it("a course with a later group's eye on it is spent last", () => {
    // Two pools in one domain share a course; the first pool should leave
    // the shared course for the second when it has another way to finish.
    const pool = (key: string, from: string[], credits: number, sortOrder: number): RequirementGroup => ({
      programId: GEOLOGY, key, name: key, ruleType: "choose_credits", section: "major",
      logic: { from, credits }, eligibleCourseIds: from, requiredCredits: credits,
      requiredCourseCount: null, sortOrder,
    });
    const first = pool("first", ["gly2100c", "gly2010c"], 4, 0);
    const second = pool("second", ["gly2100c"], 4, 1);
    const holdings = holdingsOf(new CourseHistory(record, catalog));
    const claimed = new Map<string, string>();
    const ctx = {
      catalog, holdings, claimed, overlapAllowed: () => false, substitutes: [],
      nameOf: (k: string) => k,
    };
    const a = evaluateGroup(first, { ...ctx, contested: (id) => id === "gly2100c" });
    const b = evaluateGroup(second, { ...ctx, contested: () => false });
    expect(a.applied.map((h) => h.courseId)).toEqual(["gly2010c"]);
    expect(b.applied.map((h) => h.courseId)).toEqual(["gly2100c"]);
  });
});

describe("a finished student", () => {
  it("satisfies the Geology minor once every course is completed", () => {
    const r = withRecord((x) => {
      x.attempts = x.attempts.map((a) => (a.status === "in_progress" ? { ...a, status: "completed", grade: "B", term: { season: "spring", year: 2026 } } : a));
      x.attempts.push({ attemptId: "a15", courseId: "gly3105c", status: "completed", grade: "A", credits: 4, source: "uf", term: { season: "spring", year: 2026 } });
    });
    const audit = auditProgram(catalog, r, GEOLOGY);
    expect(audit.requirements.map((q) => q.status)).toEqual(["satisfied", "satisfied", "satisfied"]);
    expect(audit.overallStatus).toBe("satisfied");
    expect(audit.reasons).toEqual([]);
    // GLY 3105C is an alternative in the first slot too, but GLY 2100C
    // already fills it, so GLY 3105C pays into the 3000/4000 pool.
    expect(requirement(audit, "elective-gly-courses-3000-4000-level-6").appliedCourses.map((c) => c.courseId).sort()).toEqual(["gly3105c", "gly4155c"]);
  });
});

describe("record facts and exceptions", () => {
  it("a Florida AA waives the gen ed groups that say so", () => {
    const r = withRecord((x) => (x.facts.hasFloridaAA = true));
    const comp = requirement(auditProgram(catalog, r, "uglas-psy_bs01"), "gened-composition");
    expect(comp.status).toBe("satisfied");
    expect(comp.reasons.map((x) => x.code)).toEqual(["waived"]);
  });

  it("an unknown waiving fact turns an unmet group unknown", () => {
    const r = withRecord((x) => (x.facts = {}));
    const lang = requirement(auditProgram(catalog, r, "uglas-psy_bs01"), "clas-foreign-language");
    expect(lang.status).toBe("unknown");
    expect(lang.reasons.map((x) => x.code)).toContain("missing_input");
  });

  it("a substitution fills the slot of the course it replaces", () => {
    const r = withRecord((x) => {
      // The student never took GLY 3202C; the department accepts GLY 4155C.
      x.attempts = x.attempts.filter((a) => a.courseId !== "gly3202c");
      x.exceptions.push({
        kind: "substitution",
        exceptionId: "x-sub",
        programId: GEOLOGY,
        requirementKey: "requirements",
        courseId: "gly4155c",
        replacesCourseId: "gly3202c",
        note: "Department approval.",
      });
    });
    const req = requirement(auditProgram(catalog, r, GEOLOGY), "requirements");
    const sub = req.pendingCourses.find((c) => c.courseId === "gly4155c")!;
    expect(sub).toMatchObject({ via: "substitution", evidenceId: "x-sub" });
    expect(req.reasons.map((x) => x.code)).toContain("substitution_applied");
  });

  it("a waiver exception satisfies the group without courses", () => {
    const r = withRecord((x) =>
      x.exceptions.push({ kind: "waiver", exceptionId: "x-w", programId: GEOLOGY, requirementKey: "elective-gly-courses-3000-4000-level-6", note: "Study abroad." }),
    );
    const audit = auditProgram(catalog, r, GEOLOGY);
    expect(requirement(audit, "elective-gly-courses-3000-4000-level-6").status).toBe("satisfied");
    expect(audit.overallStatus).toBe("in_progress");
  });

  it("a completed course with no grade makes the slot it would fill unknown", () => {
    const r = withRecord((x) => delete x.attempts.find((a) => a.attemptId === "a05")!.grade);
    const req = requirement(auditProgram(catalog, r, GEOLOGY), "requirements");
    expect(req.status).toBe("unknown");
    expect(req.reasons.map((x) => x.code)).toContain("missing_grade");
  });
});

describe("shapes", () => {
  it("reads options before credits, and choose_n without slots as any-N", () => {
    const groups = Object.values(catalog.programs).flatMap((p) => p.requirements);
    const mathSequence = groups.find((g) => g.programId === "uglas-mat_ba" && g.key === "select-one-sequence")!;
    expect(groupShape(mathSequence).kind).toBe("options");
    const anyN = groups.find((g) => g.ruleType === "choose_n" && !g.logic.slots?.length)!;
    expect(groupShape(anyN).kind).toBe("count");
  });

  it("spends broad pools after specific groups", () => {
    const order = spendOrder(catalog.programs[GEOLOGY].requirements).map((g) => g.key);
    expect(order).toEqual(["requirements", "approved-electives", "elective-gly-courses-3000-4000-level-6"]);
  });
});

describe("whole catalog", () => {
  it("audits every program to a valid, deterministic result", () => {
    const history = new CourseHistory(record, catalog);
    for (const id of Object.keys(catalog.programs)) {
      const audit = auditProgram(catalog, record, id, history);
      expect(auditProgram(catalog, record, id, history)).toEqual(audit);
    }
  });
});
