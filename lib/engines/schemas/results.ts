import { z } from "zod";
import {
  CourseId,
  ProgramId,
  Reason,
  ResultVersions,
  SourceReference,
  Term,
} from "./common";
import { RuleType, Section } from "./catalog";
import { Grade } from "./record";
import {
  ELIGIBILITY_OF,
  EligibilityStatus,
  MilestoneStatus,
  RequirementStatus,
  RequisiteValue,
  TrackingStatus,
  combineAnd,
  combineMilestones,
  combineOr,
  combineRequirementStatuses,
} from "../status";

/**
 * What the engines return. These are the shapes the frontend renders and the
 * advisor explains; neither recomputes any of it.
 *
 * Every schema here checks its own arithmetic and statuses (the superRefine
 * blocks), so a result whose status contradicts its numbers fails validation
 * instead of reaching a student. The combine rules come from ../status.ts,
 * the same functions the engines use to produce the statuses.
 */

const EPSILON = 1e-9;
const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** One course counted toward something, with the record entry behind it. */
export const AppliedCourse = z.strictObject({
  courseId: CourseId,
  /** Display code, "GLY 2100C". */
  code: z.string(),
  credits: z.number().nonnegative(),
  /** The record entry relied on: an attemptId, examCreditId or exceptionId. */
  evidenceId: z.string().min(1),
  via: z.enum(["uf", "transfer", "dual_enrollment", "exam", "substitution"]),
  grade: Grade.optional(),
  term: Term.optional(),
});
export type AppliedCourse = z.infer<typeof AppliedCourse>;

/** What a rule asks for. Null = the rule doesn't count that unit. */
export const RequiredAmount = z.strictObject({
  credits: z.number().nonnegative().nullable(),
  courses: z.int().nonnegative().nullable(),
});

export const Progress = z.strictObject({
  credits: z.number().nonnegative(),
  courses: z.int().nonnegative(),
});
type ProgressT = z.infer<typeof Progress>;

function meets(required: z.infer<typeof RequiredAmount>, have: ProgressT): boolean {
  return (
    (required.credits === null || have.credits + EPSILON >= required.credits) &&
    (required.courses === null || have.courses >= required.courses)
  );
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const RequirementResult = z
  .strictObject({
    programId: ProgramId,
    requirementKey: z.string().min(1),
    name: z.string(),
    section: Section,
    ruleType: RuleType,
    /** False for section "options": progress is shown, the degree never
     *  waits on it. */
    countsTowardDegree: z.boolean(),
    status: RequirementStatus,
    reasons: z.array(Reason),
    required: RequiredAmount,
    /** Completed work only. Credits are the applied courses' own credits,
     *  never split: a 4-credit course meeting a 3-credit rule shows 4. */
    completed: Progress,
    /** Current-term enrollment that would count when passed. */
    inProgress: Progress,
    appliedCourses: z.array(AppliedCourse),
    pendingCourses: z.array(AppliedCourse),
    remainingOptions: z.strictObject({
      /** Courses that could still fill it (may be truncated). */
      courseIds: z.array(CourseId),
      /** How many options exist in all, so a consumer can say "and 24 more". */
      total: z.int().nonnegative(),
      /** Prose slots the catalog printed instead of a list. */
      openSlots: z.array(z.strictObject({ label: z.string(), credits: z.number().nullable() })),
    }),
    sources: z.array(SourceReference),
  })
  .superRefine((r, ctx) => {
    const issue = (message: string, path: string[] = ["status"]) =>
      ctx.addIssue({ code: "custom", path, message });
    if (Math.abs(r.completed.credits - sum(r.appliedCourses.map((c) => c.credits))) > EPSILON)
      issue("completed.credits must equal the sum of appliedCourses credits", ["completed"]);
    if (r.completed.courses !== r.appliedCourses.length)
      issue("completed.courses must equal appliedCourses.length", ["completed"]);
    if (Math.abs(r.inProgress.credits - sum(r.pendingCourses.map((c) => c.credits))) > EPSILON)
      issue("inProgress.credits must equal the sum of pendingCourses credits", ["inProgress"]);
    if (r.inProgress.courses !== r.pendingCourses.length)
      issue("inProgress.courses must equal pendingCourses.length", ["inProgress"]);
    if (r.countsTowardDegree === (r.section === "options"))
      issue("countsTowardDegree must be false exactly for section options", ["countsTowardDegree"]);

    const total = {
      credits: r.completed.credits + r.inProgress.credits,
      courses: r.completed.courses + r.inProgress.courses,
    };
    const waived = r.reasons.some((x) => x.code === "waived");
    switch (r.status) {
      case "unknown":
        if (r.reasons.length === 0) issue("an unknown requirement needs a reason");
        break;
      case "satisfied":
        if (!meets(r.required, r.completed) && !waived)
          issue("satisfied requires completed work to meet the requirement (or a waiver)");
        break;
      case "in_progress":
        if (!meets(r.required, total)) issue("in_progress requires completed + in-progress work to meet the requirement");
        if (r.pendingCourses.length === 0) issue("in_progress requires at least one pending course");
        break;
      case "not_satisfied":
        // Totals can meet the numbers while a count rule fails; then say so.
        if (meets(r.required, total) && r.reasons.length === 0)
          issue("not_satisfied with enough credits/courses needs a reason (e.g. count_rule_unmet)");
        break;
    }
  });
export type RequirementResult = z.infer<typeof RequirementResult>;

/** GPA types are labelled, never a bare "GPA". Only uf_cumulative follows a
 *  rule fully stated in the data we have (UF's grading policy); the others
 *  depend on course sets that programs define, and stay unknown until the
 *  data captures them. */
export const GpaResult = z
  .strictObject({
    kind: z.enum(["uf_cumulative", "upper_division", "major", "critical_tracking"]),
    status: z.enum(["computed", "unknown"]),
    /** Rounded to 2 places for display; gradePoints / gpaHours is exact. */
    value: z.number().min(0).max(4).nullable(),
    gradePoints: z.number().nonnegative(),
    gpaHours: z.number().nonnegative(),
    /** Every attempt counted (a repeat contributes each attempt). */
    attemptIds: z.array(z.string()),
    reasons: z.array(Reason),
  })
  .superRefine((g, ctx) => {
    if (g.status === "computed" && g.value === null)
      ctx.addIssue({ code: "custom", path: ["value"], message: "a computed GPA needs a value" });
    if (g.status === "unknown" && g.reasons.length === 0)
      ctx.addIssue({ code: "custom", path: ["reasons"], message: "an unknown GPA needs a reason" });
  });
export type GpaResult = z.infer<typeof GpaResult>;

export const AuditResult = z
  .strictObject({
    versions: ResultVersions,
    programId: ProgramId,
    programName: z.string(),
    programKind: z.enum(["major", "minor", "certificate"]),
    /** From the data. needs_review: show a warning; the overall status is at
     *  best unknown. */
    programStatus: z.enum(["published", "needs_review"]),
    overallStatus: RequirementStatus,
    /** Why the overall status is what it is. */
    reasons: z.array(Reason),
    /** What this audit did NOT check (program prose rules, grade minimums).
     *  The advisor should mention these whenever it reports a status. */
    caveats: z.array(Reason),
    totals: z.strictObject({
      required: z.strictObject({ credits: z.number().nonnegative().nullable() }),
      completed: z.strictObject({ credits: z.number().nonnegative() }),
      inProgress: z.strictObject({ credits: z.number().nonnegative() }),
    }),
    requirements: z.array(RequirementResult),
    /** Record courses this program counted nowhere (free electives here). */
    unappliedCourses: z.array(AppliedCourse),
    gpa: z.array(GpaResult),
    sources: z.array(SourceReference),
  })
  .superRefine((a, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    const keys = new Set<string>();
    a.requirements.forEach((r, i) => {
      if (r.programId !== a.programId) issue(["requirements", i, "programId"], "requirement from another program");
      if (keys.has(r.requirementKey)) issue(["requirements", i, "requirementKey"], "duplicate requirementKey");
      keys.add(r.requirementKey);
    });
    const counting = a.requirements.filter((r) => r.countsTowardDegree);
    const expected = combineRequirementStatuses(
      counting.map((r) => r.status),
      a.programStatus === "needs_review",
    );
    if (a.overallStatus !== expected)
      issue(["overallStatus"], `overallStatus must be "${expected}" for these requirement statuses`);
    if (a.overallStatus !== "satisfied" && a.reasons.length === 0)
      issue(["reasons"], "an overall status other than satisfied needs a reason");

    const req = counting.map((r) => r.required.credits);
    const expectedRequired = req.some((c) => c === null) ? null : sum(req as number[]);
    if (a.totals.required.credits !== expectedRequired)
      issue(["totals", "required"], `totals.required.credits must be ${expectedRequired}`);
    if (Math.abs(a.totals.completed.credits - sum(counting.map((r) => r.completed.credits))) > EPSILON)
      issue(["totals", "completed"], "totals.completed must sum the counting requirements' completed credits");
    if (Math.abs(a.totals.inProgress.credits - sum(counting.map((r) => r.inProgress.credits))) > EPSILON)
      issue(["totals", "inProgress"], "totals.inProgress must sum the counting requirements' in-progress credits");
  });
export type AuditResult = z.infer<typeof AuditResult>;

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** The requisite tree, evaluated: each node keeps its type and gains a value,
 *  a readable label, and the record entries that decided it. */
export type RequisiteEvaluation = {
  type: string;
  value: RequisiteValue;
  label: string;
  evidenceIds?: string[];
  children?: RequisiteEvaluation[];
};

export const RequisiteEvaluation: z.ZodType<RequisiteEvaluation> = z.lazy(() =>
  z.strictObject({
    type: z.enum([
      "and", "or", "course", "credits", "standing", "program",
      "gpa", "permission", "placement", "equivalent", "unparsed",
    ]),
    value: RequisiteValue,
    label: z.string().min(1),
    evidenceIds: z.array(z.string()).optional(),
    children: z.array(RequisiteEvaluation).optional(),
  }),
);

/** Paths of and/or nodes whose value doesn't follow from their children. */
function inconsistentNodes(node: RequisiteEvaluation, path: (string | number)[]): (string | number)[][] {
  const kids = node.children ?? [];
  const bad: (string | number)[][] = [];
  if (node.type === "and" || node.type === "or") {
    const values = kids.map((k) => k.value);
    const expected = node.type === "and" ? combineAnd(values) : combineOr(values);
    if (kids.length === 0 || node.value !== expected) bad.push(path);
  }
  kids.forEach((k, i) => bad.push(...inconsistentNodes(k, [...path, "children", i])));
  return bad;
}

export const EligibilityResult = z
  .strictObject({
    versions: ResultVersions,
    courseId: CourseId,
    /** The term the student would take it. */
    term: Term,
    status: EligibilityStatus,
    /** Null when the course has none. */
    prerequisite: RequisiteEvaluation.nullable(),
    corequisite: RequisiteEvaluation.nullable(),
    reasons: z.array(Reason),
    sources: z.array(SourceReference),
  })
  .superRefine((e, ctx) => {
    for (const field of ["prerequisite", "corequisite"] as const) {
      const tree = e[field];
      if (tree)
        for (const path of inconsistentNodes(tree, [field]))
          ctx.addIssue({ code: "custom", path, message: "and/or value doesn't follow from its children" });
    }
    const expected =
      ELIGIBILITY_OF[combineAnd([e.prerequisite?.value ?? "met", e.corequisite?.value ?? "met"])];
    if (e.status !== expected)
      ctx.addIssue({ code: "custom", path: ["status"], message: `status must be "${expected}" for these requisites` });
    if (e.status !== "eligible" && e.reasons.length === 0)
      ctx.addIssue({ code: "custom", path: ["reasons"], message: "a status other than eligible needs a reason" });
  });
export type EligibilityResult = z.infer<typeof EligibilityResult>;

// ---------------------------------------------------------------------------
// Critical Tracking
// ---------------------------------------------------------------------------

export const MilestoneResult = z
  .strictObject({
    /** Enrolled fall/spring semester it is due by. */
    semester: z.int().min(1),
    kind: z.enum(["courses", "count", "gpa", "note"]),
    status: MilestoneStatus,
    /** UF's own sentence for it. */
    rawText: z.string(),
    /** Slots that must be held (all of them for `courses`, `count` for
     *  count). Null for gpa and note milestones. */
    required: z.int().nonnegative().nullable(),
    /** The minimum grade a course needed to count here (null: any passing
     *  grade). */
    minGrade: Grade.nullable(),
    /** For a gpa milestone: which GPA, the threshold, and the student's value
     *  when the engine can compute it (only the UF cumulative GPA today). */
    gpa: z
      .strictObject({
        scope: z.enum(["uf", "critical_tracking", "upper_division", "all_institutions", "other"]),
        min: z.number(),
        value: z.number().nullable(),
      })
      .nullable(),
    /** Courses that hold a slot from completed work / from current enrollment. */
    satisfiedBy: z.array(CourseId),
    pendingCourses: z.array(CourseId),
    /** Display text for each slot still open, "PSB 3340" or "PSY 3213L or STA 2023". */
    missing: z.array(z.string()),
    reasons: z.array(Reason),
  })
  .superRefine((m, ctx) => {
    if (m.status === "unknown" && m.reasons.length === 0)
      ctx.addIssue({ code: "custom", path: ["reasons"], message: "an unknown milestone needs a reason" });
    if (m.status === "pending" && m.pendingCourses.length === 0)
      ctx.addIssue({ code: "custom", path: ["pendingCourses"], message: "a pending milestone needs pending courses" });
    if ((m.kind === "gpa") !== (m.gpa !== null))
      ctx.addIssue({ code: "custom", path: ["gpa"], message: "a gpa milestone (and only one) says which GPA it checked" });
  });
export type MilestoneResult = z.infer<typeof MilestoneResult>;

export const TrackingResult = z
  .strictObject({
    versions: ResultVersions,
    programId: ProgramId,
    /** Enrolled fall/spring semesters including the current one (summers
     *  don't count, as in UF's tracking language). */
    currentSemester: z.int().min(1),
    status: TrackingStatus,
    milestones: z.array(MilestoneResult),
    reasons: z.array(Reason),
    caveats: z.array(Reason),
    sources: z.array(SourceReference),
  })
  .superRefine((t, ctx) => {
    const expected = combineMilestones(t.milestones, t.currentSemester);
    if (t.status !== expected)
      ctx.addIssue({ code: "custom", path: ["status"], message: `status must be "${expected}" for these milestones` });
    if (t.status !== "met" && t.reasons.length === 0)
      ctx.addIssue({ code: "custom", path: ["reasons"], message: "a status other than met needs a reason" });
  });
export type TrackingResult = z.infer<typeof TrackingResult>;
