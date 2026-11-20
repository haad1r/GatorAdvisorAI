/* eslint-disable @typescript-eslint/no-explicit-any --
 * These tests break valid examples on purpose to prove the schemas reject the
 * result; typing the broken objects would defeat that. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AcademicRecord,
  AuditResult,
  EligibilityResult,
  Plan,
  TrackingResult,
  combineAnd,
  combineMilestones,
  combineOr,
  combineRequirementStatuses,
  compareTerms,
} from "../schemas";

/** A fresh, mutable copy of an example for each test to break. */
const example = <T = any>(name: string): T =>
  JSON.parse(readFileSync(join(__dirname, "..", "examples", name), "utf8"));

const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.message);

describe("status rules", () => {
  it("program status is the worst requirement status; not_satisfied outranks unknown", () => {
    expect(combineRequirementStatuses(["satisfied", "in_progress"], false)).toBe("in_progress");
    expect(combineRequirementStatuses(["unknown", "not_satisfied"], false)).toBe("not_satisfied");
    expect(combineRequirementStatuses(["satisfied", "unknown"], false)).toBe("unknown");
  });

  it("a program that needs review is never better than unknown", () => {
    expect(combineRequirementStatuses(["satisfied"], true)).toBe("unknown");
    expect(combineRequirementStatuses(["not_satisfied"], true)).toBe("not_satisfied");
  });

  it("nothing to judge is unknown, not satisfied", () => {
    expect(combineRequirementStatuses([], false)).toBe("unknown");
  });

  it("AND: one not_met settles it; OR: one met or pending route is enough", () => {
    expect(combineAnd(["met", "unknown", "not_met"])).toBe("not_met");
    expect(combineAnd(["met", "unknown"])).toBe("unknown");
    expect(combineAnd(["met", "pending"])).toBe("pending");
    expect(combineOr(["not_met", "unknown"])).toBe("unknown");
    expect(combineOr(["unknown", "pending"])).toBe("pending");
    expect(combineOr(["not_met", "met"])).toBe("met");
  });

  it("upcoming milestones don't put tracking at risk", () => {
    expect(combineMilestones([{ semester: 5, status: "upcoming" }], 3)).toBe("met");
    expect(combineMilestones([{ semester: 3, status: "pending" }], 3)).toBe("at_risk");
    expect(combineMilestones([{ semester: 3, status: "unknown" }, { semester: 2, status: "not_met" }], 3)).toBe("not_met");
  });

  it("orders terms spring < summer < fall within a year", () => {
    expect(compareTerms({ season: "fall", year: 2026 }, { season: "spring", year: 2027 })).toBeLessThan(0);
    expect(compareTerms({ season: "summer", year: 2026 }, { season: "spring", year: 2026 })).toBeGreaterThan(0);
  });
});

describe("AcademicRecord validation", () => {
  it("rejects an in-progress attempt with a grade", () => {
    const r = example("record.json");
    r.attempts.find((a: any) => a.attemptId === "a10").grade = "A";
    expect(messages(AcademicRecord.safeParse(r))).toContain("an in-progress attempt has no grade yet");
  });

  it("rejects duplicate entry ids across attempts and exam credit", () => {
    const r = example("record.json");
    r.examCredits[0].examCreditId = "a01";
    expect(messages(AcademicRecord.safeParse(r))).toContain('duplicate entry id "a01"');
  });

  it("rejects an in-progress attempt outside the current term", () => {
    const r = example("record.json");
    r.attempts.find((a: any) => a.attemptId === "a10").term = { season: "spring", year: 2026 };
    expect(messages(AcademicRecord.safeParse(r))).toContain("an in-progress attempt must be in currentTerm");
  });

  it("rejects a misspelled field instead of dropping it", () => {
    const r = example("record.json");
    r.attempts[0].grades = r.attempts[0].grade;
    delete r.attempts[0].grade;
    expect(AcademicRecord.safeParse(r).success).toBe(false);
  });

  it("rejects a grade UF doesn't use", () => {
    const r = example("record.json");
    r.attempts[0].grade = "F";
    expect(AcademicRecord.safeParse(r).success).toBe(false);
  });
});

describe("AuditResult validation", () => {
  it("rejects an overall status that doesn't follow from the requirements", () => {
    const a = example("audit.geology-minor.json");
    a.overallStatus = "in_progress";
    expect(messages(AuditResult.safeParse(a))).toContain(
      'overallStatus must be "not_satisfied" for these requirement statuses',
    );
  });

  it("rejects satisfied when completed work falls short", () => {
    const a = example("audit.geology-minor.json");
    a.requirements[0].status = "satisfied"; // 5 of 8 credits completed
    expect(messages(AuditResult.safeParse(a))).toContain(
      "satisfied requires completed work to meet the requirement (or a waiver)",
    );
  });

  it("rejects counts that don't match the listed courses", () => {
    const a = example("audit.geology-minor.json");
    a.requirements[1].completed.credits = 3; // GLY 2010C is 4 credits
    expect(messages(AuditResult.safeParse(a))).toContain(
      "completed.credits must equal the sum of appliedCourses credits",
    );
  });

  it("rejects an unknown requirement with no reason", () => {
    const a = example("audit.english-minor-needs-review.json");
    a.requirements[0].reasons = [];
    expect(messages(AuditResult.safeParse(a))).toContain("an unknown requirement needs a reason");
  });

  it("rejects a satisfied program that needs review", () => {
    const a = example("audit.english-minor-needs-review.json");
    a.overallStatus = "satisfied";
    expect(AuditResult.safeParse(a).success).toBe(false);
  });
});

describe("EligibilityResult validation", () => {
  it("rejects an OR node whose value contradicts its children", () => {
    const [e] = example<any[]>("eligibility.json");
    e.prerequisite.value = "not_met"; // one child is met
    expect(messages(EligibilityResult.safeParse(e))).toContain("and/or value doesn't follow from its children");
  });

  it("rejects unknown silently reported as eligible", () => {
    const e = example<any[]>("eligibility.json").find((x) => x.courseId === "gly4900");
    e.status = "eligible";
    e.reasons = [];
    expect(messages(EligibilityResult.safeParse(e))).toContain('status must be "unknown" for these requisites');
  });
});

describe("TrackingResult and Plan validation", () => {
  it("rejects a tracking status that hides a due unknown milestone", () => {
    const t = example("tracking.psychology-bs.json");
    t.status = "met";
    expect(messages(TrackingResult.safeParse(t))).toContain('status must be "unknown" for these milestones');
  });

  it("rejects an infeasible plan with no blocker", () => {
    const p = example("plan.psychology-geology.json");
    p.status = "infeasible";
    expect(messages(Plan.safeParse(p))).toContain("an infeasible plan must name its blocker");
  });

  it("rejects a term whose credits don't add up", () => {
    const p = example("plan.psychology-geology.json");
    p.terms[0].credits = 6;
    expect(messages(Plan.safeParse(p))).toContain("credits must sum the term's courses");
  });
});
