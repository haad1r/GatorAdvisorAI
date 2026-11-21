import { z } from "zod";
import { CatalogYear, CourseId, ProgramId, Reason, ResultVersions, Term } from "./common";
import { Section } from "./catalog";
import { DeclaredProgram } from "./record";
import { AuditResult, GpaResult, OfferingStatus, TakenStatus, TrackingResult } from "./results";
import { Plan } from "./plan";
import { EligibilityStatus, RequirementStatus, TrackingStatus } from "../status";

/**
 * Student-level results: one call per student, over every declared program.
 * These are what the issue's functions return (lib/engines/index.ts):
 *
 *   audit(record)                    -> StudentAudit
 *   requirementFlags(record, codes)  -> RequirementFlags
 *   filterCandidates(record, codes)  -> CandidateFilter
 *   tracking(record)                 -> StudentTracking
 *   whatIf(record, change)           -> WhatIfResult
 *
 * Each is built from the per-program results (AuditResult, TrackingResult),
 * never recomputed, and checks its own consistency like those do.
 */

// ---------------------------------------------------------------------------
// Audit, whole student
// ---------------------------------------------------------------------------

/** Where a course counts. `pending`: through a current enrollment. */
export const CountedIn = z.strictObject({
  programId: ProgramId,
  requirementKey: z.string().min(1),
  name: z.string(),
  section: Section,
  pending: z.boolean(),
});

export const StudentAudit = z
  .strictObject({
    versions: ResultVersions,
    /** One audit per declared program, in the record's order. */
    programs: z.array(AuditResult),
    /** Credit the student holds, each course once (a repeat's credit counts
     *  once), plus elective credit. Earned is completed work and exam
     *  credit; inProgress is current enrollment, kept apart because it is
     *  not earned until graded. */
    credits: z.strictObject({
      earned: z.number().nonnegative(),
      inProgress: z.number().nonnegative(),
    }),
    /** Student-wide GPAs (program-specific ones are in each audit). */
    gpa: z.array(GpaResult),
    /** Courses counting toward two or more requirements at once (across
     *  programs, or major and gen ed within one). */
    sharedCourses: z.array(
      z.strictObject({ courseId: CourseId, code: z.string(), countedIn: z.array(CountedIn).min(2) }),
    ),
    /** Everything the engine couldn't decide. A needs_review program is one
     *  entry (requirementKey null); otherwise one per unknown requirement. */
    unknowns: z.array(
      z.strictObject({
        programId: ProgramId,
        requirementKey: z.string().nullable(),
        name: z.string(),
        reasons: z.array(Reason).min(1),
      }),
    ),
  })
  .superRefine((s, ctx) => {
    s.sharedCourses.forEach((c, i) => {
      const keys = c.countedIn.map((x) => `${x.programId}/${x.requirementKey}`);
      if (new Set(keys).size !== keys.length)
        ctx.addIssue({ code: "custom", path: ["sharedCourses", i], message: "a requirement listed twice" });
    });
  });
export type StudentAudit = z.infer<typeof StudentAudit>;

// ---------------------------------------------------------------------------
// Requirement flags: "does this course help me?"
// ---------------------------------------------------------------------------

/** yes: it can fill a requirement the audit shows open (not_satisfied).
 *  unknown: it is listed for a requirement the audit can't decide (a program
 *    under review, a fact the record lacks), and nothing open lists it.
 *  no: no open or undecided requirement lists it, or the student holds it. */
export const Flag = z.enum(["yes", "no", "unknown"]);
export type Flag = z.infer<typeof Flag>;

export const OpenRequirement = z.strictObject({
  programId: ProgramId,
  programKind: z.enum(["major", "minor", "certificate"]),
  requirementKey: z.string().min(1),
  name: z.string(),
  section: Section,
  /** not_satisfied or unknown: the only statuses a course can still help. */
  status: RequirementStatus,
});

export const CourseFlags = z
  .strictObject({
    courseId: CourseId,
    code: z.string(),
    /** Any open requirement of any declared program (gen ed included). */
    fillsRequirement: Flag,
    /** An open requirement in the "major" section of a declared major. */
    fillsMajorSlot: Flag,
    /** The open requirements that list it. */
    requirements: z.array(OpenRequirement),
    reasons: z.array(Reason),
  })
  .superRefine((c, ctx) => {
    const flagOf = (rs: { status: string }[]): Flag =>
      rs.some((r) => r.status === "not_satisfied") ? "yes" : rs.some((r) => r.status === "unknown") ? "unknown" : "no";
    const major = c.requirements.filter((r) => r.programKind === "major" && r.section === "major");
    if (c.requirements.some((r) => r.status !== "not_satisfied" && r.status !== "unknown"))
      ctx.addIssue({ code: "custom", path: ["requirements"], message: "only open (not_satisfied / unknown) requirements are listed" });
    if (c.fillsRequirement !== flagOf(c.requirements))
      ctx.addIssue({ code: "custom", path: ["fillsRequirement"], message: `must be "${flagOf(c.requirements)}" for these requirements` });
    if (c.fillsMajorSlot !== flagOf(major))
      ctx.addIssue({ code: "custom", path: ["fillsMajorSlot"], message: `must be "${flagOf(major)}" for these requirements` });
  });
export type CourseFlags = z.infer<typeof CourseFlags>;

export const RequirementFlags = z.strictObject({
  versions: ResultVersions,
  courses: z.array(CourseFlags),
  /** What the flags don't account for (prose slots such as "approved
   *  elective", which list no courses). */
  caveats: z.array(Reason),
});
export type RequirementFlags = z.infer<typeof RequirementFlags>;

// ---------------------------------------------------------------------------
// Candidate filter: the hard filter before scoring
// ---------------------------------------------------------------------------

/** candidate: may be recommended (eligible or eligible_pending, not held,
 *    not known to be unscheduled).
 *  needs_check: can't be ruled in or out (eligibility unknown, offering
 *    unknown or not seen, a completed attempt with no grade). Never treat
 *    as a candidate without a person checking.
 *  excluded: already passed or enrolled, not eligible, not in the term's
 *    complete published schedule, or not a catalog course. */
export const CandidateDecision = z.enum(["candidate", "needs_check", "excluded"]);
export type CandidateDecision = z.infer<typeof CandidateDecision>;

export const CandidateCourse = z
  .strictObject({
    /** Null when the input wasn't a course code at all. */
    courseId: CourseId.nullable(),
    /** The input as given ("STA 3100"). */
    input: z.string(),
    decision: CandidateDecision,
    /** Null for a course the catalog doesn't have. */
    eligibility: EligibilityStatus.nullable(),
    taken: TakenStatus.nullable(),
    offering: OfferingStatus.nullable(),
    reasons: z.array(Reason),
  })
  .superRefine((c, ctx) => {
    if (c.decision === "candidate" && !(c.eligibility === "eligible" || c.eligibility === "eligible_pending"))
      ctx.addIssue({ code: "custom", path: ["decision"], message: "a candidate must be eligible or eligible_pending" });
    if (c.decision === "candidate" && (c.taken === "passed" || c.taken === "in_progress" || c.taken === "no_grade"))
      ctx.addIssue({ code: "custom", path: ["decision"], message: "a course already held can't be a candidate" });
    if (c.decision !== "candidate" && c.reasons.length === 0)
      ctx.addIssue({ code: "custom", path: ["reasons"], message: "a course that isn't a candidate needs a reason" });
  });
export type CandidateCourse = z.infer<typeof CandidateCourse>;

export const CandidateFilter = z.strictObject({
  versions: ResultVersions,
  term: Term,
  courses: z.array(CandidateCourse),
});
export type CandidateFilter = z.infer<typeof CandidateFilter>;

// ---------------------------------------------------------------------------
// Tracking, whole student
// ---------------------------------------------------------------------------

export const StudentTracking = z.strictObject({
  versions: ResultVersions,
  /** One per declared program that publishes milestones. */
  programs: z.array(TrackingResult),
  /** Declared programs with no tracking milestones (every minor and
   *  certificate, some majors). */
  untracked: z.array(z.strictObject({ programId: ProgramId, reason: z.string() })),
  /** The soonest next deadline across programs. */
  nextDeadline: z
    .strictObject({ programId: ProgramId, semester: z.int().min(1), term: Term })
    .nullable(),
});
export type StudentTracking = z.infer<typeof StudentTracking>;

// ---------------------------------------------------------------------------
// What-if
// ---------------------------------------------------------------------------

/** A hypothetical change to the declared programs. Applied to a COPY of the
 *  record; the saved record is never touched. */
export const WhatIfChange = z
  .strictObject({
    /** Replace the declared programs outright. */
    programs: z.array(DeclaredProgram).optional(),
    add: z.array(ProgramId).optional(),
    remove: z.array(ProgramId).optional(),
    /** Only the loaded catalog's year can be evaluated today. */
    catalogYear: CatalogYear.optional(),
  })
  .refine((c) => !(c.programs && (c.add || c.remove)), "give programs, or add/remove, not both");
export type WhatIfChange = z.infer<typeof WhatIfChange>;

export const ProgramSummary = z.strictObject({
  programId: ProgramId,
  name: z.string(),
  kind: z.enum(["major", "minor", "certificate"]),
  overallStatus: RequirementStatus,
  completedCredits: z.number().nonnegative(),
  inProgressCredits: z.number().nonnegative(),
  remainingCredits: z.number().nonnegative().nullable(),
  requirements: z.strictObject({
    satisfied: z.int().nonnegative(),
    in_progress: z.int().nonnegative(),
    not_satisfied: z.int().nonnegative(),
    unknown: z.int().nonnegative(),
  }),
  /** Null when the program publishes no milestones. */
  tracking: TrackingStatus.nullable(),
});
export type ProgramSummary = z.infer<typeof ProgramSummary>;

export const WhatIfResult = z.strictObject({
  basis: z.literal("what_if"),
  change: WhatIfChange,
  /** Versions of the saved record (baseline) and of the copy (scenario). */
  baseline: z.strictObject({ versions: ResultVersions, programs: z.array(ProgramSummary) }),
  scenario: z.strictObject({
    versions: ResultVersions,
    audit: StudentAudit,
    tracking: StudentTracking,
    programs: z.array(ProgramSummary),
  }),
  diff: z.strictObject({
    added: z.array(ProgramId),
    removed: z.array(ProgramId),
    /** Programs in both, whose summaries differ (a catalog-year change). */
    changed: z.array(ProgramId),
  }),
  /** Present when plan options were given: the saved (or a freshly
   *  generated) plan for the record, a new plan for the copy, and how they
   *  differ. The saved plan is returned as given, never modified. */
  plans: z
    .strictObject({
      baseline: Plan,
      scenario: Plan,
      diff: z.strictObject({
        status: z.strictObject({ baseline: z.enum(["feasible", "infeasible"]), scenario: z.enum(["feasible", "infeasible"]) }),
        plannedCredits: z.strictObject({ baseline: z.number(), scenario: z.number() }),
        /** The last term with a course planned (null: nothing planned). */
        lastTerm: z.strictObject({ baseline: Term.nullable(), scenario: Term.nullable() }),
        coursesAdded: z.array(CourseId),
        coursesDropped: z.array(CourseId),
      }),
    })
    .nullable(),
  caveats: z.array(Reason),
});
export type WhatIfResult = z.infer<typeof WhatIfResult>;
