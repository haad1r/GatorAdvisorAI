import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../catalog/load";
import { evaluateEligibility } from "../eligibility";
import { CourseHistory, meetsMinimum } from "../history";
import {
  AcademicRecord,
  EligibilityResult,
  type RequisiteEvaluation,
  type Term,
} from "../schemas";

const catalog = loadCatalog(join(__dirname, "..", "..", "..", "data"));
const example = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "..", "examples", name), "utf8"));
const record = AcademicRecord.parse(example("record.json"));
const SPRING_2027: Term = { season: "spring", year: 2027 };

/** A record variant: same student, edited. */
const withRecord = (edit: (r: AcademicRecord) => void): AcademicRecord => {
  const r = structuredClone(record);
  edit(r);
  return AcademicRecord.parse(r);
};

/** Type, value and evidence of every node; labels are prose and may differ. */
const skeleton = (ev: RequisiteEvaluation): unknown => ({
  type: ev.type,
  value: ev.value,
  evidence: ev.evidenceIds ?? [],
  children: ev.children?.map(skeleton),
});

describe("eligibility engine reproduces the hand-built examples", () => {
  for (const expected of EligibilityResult.array().parse(example("eligibility.json"))) {
    it(`${expected.courseId}: ${expected.status}`, () => {
      const got = evaluateEligibility(catalog, record, expected.courseId, expected.term);
      expect(got.status).toBe(expected.status);
      expect(skeleton(got.prerequisite!)).toEqual(skeleton(expected.prerequisite!));
      expect(got.corequisite).toBeNull();
      expect(got.reasons.map((r) => r.code)).toEqual(expected.reasons.map((r) => r.code));
      expect(got.sources).toEqual(expected.sources);
      expect(got.versions).toEqual(expected.versions);
    });
  }
});

describe("grade rules", () => {
  it("a minimum grade compares grade points; D passes only without one", () => {
    expect(meetsMinimum("C", "C")).toBe(true);
    expect(meetsMinimum("C-", "C")).toBe(false);
    expect(meetsMinimum("D", undefined)).toBe(true);
    expect(meetsMinimum("E", undefined)).toBe(false);
    expect(meetsMinimum("W", undefined)).toBe(false);
  });

  it("S equals C or better, unless the minimum is higher and S isn't named", () => {
    expect(meetsMinimum("S", "C")).toBe(true);
    expect(meetsMinimum("S", "B")).toBe(false);
    expect(meetsMinimum("S", "B", true)).toBe(true);
    expect(meetsMinimum("U", undefined)).toBe(false);
  });

  it("a repeat earns its credit once, cited by the later attempt", () => {
    const earned = new CourseHistory(record, catalog).earnedByCourse();
    expect(earned.completed.filter((h) => h.courseId === "bsc2010").map((h) => h.entryId)).toEqual(["a07"]);
  });
});

describe("leaf rules", () => {
  it("a completed attempt with no grade is unknown, not met", () => {
    const r = withRecord((x) => delete x.attempts.find((a) => a.attemptId === "a02")!.grade);
    const got = evaluateEligibility(catalog, r, "gly3105c", SPRING_2027);
    expect(got.status).toBe("unknown");
    expect(got.reasons.map((x) => x.code)).toEqual(["missing_grade"]);
  });

  it("a declared program satisfies a program-code leaf; others are not met", () => {
    const r = withRecord((x) => x.programs.push({ programId: "ugpbh-hes_bhs02" }));
    const got = evaluateEligibility(catalog, r, "hsa3111", SPRING_2027);
    // Program now met, standing still unknown: the AND is unknown.
    expect(got.status).toBe("unknown");
    expect(got.reasons.map((x) => x.code)).toEqual(["rule_not_modeled"]);
  });

  it("a concurrent course satisfies a corequisite but never a prerequisite", () => {
    const withCoreq = Object.values(catalog.courses).find(
      (c) => c.corequisite?.tree?.type === "course" && !c.prerequisite,
    )!;
    const coreqId = (withCoreq.corequisite!.tree as { course_id: string }).course_id;
    expect(evaluateEligibility(catalog, record, withCoreq.id, SPRING_2027).status).toBe("not_eligible");
    const together = evaluateEligibility(catalog, record, withCoreq.id, SPRING_2027, { concurrent: [coreqId] });
    expect(together.status).toBe("eligible_pending");
  });

  it("refuses a term that isn't after the current term", () => {
    expect(() => evaluateEligibility(catalog, record, "gly3105c", record.currentTerm)).toThrow(RangeError);
  });
});

describe("whole catalog", () => {
  it("evaluates every course with a requisite to a valid result", () => {
    const history = new CourseHistory(record, catalog);
    const counts: Record<string, number> = {};
    for (const c of Object.values(catalog.courses)) {
      if (!c.prerequisite && !c.corequisite) continue;
      const r = evaluateEligibility(catalog, record, c.id, SPRING_2027, {}, history);
      counts[r.status] = (counts[r.status] ?? 0) + 1;
    }
    // Every status occurs; the exact split depends on the data.
    expect(Object.keys(counts).sort()).toEqual(["eligible", "eligible_pending", "not_eligible", "unknown"]);
  });
});
