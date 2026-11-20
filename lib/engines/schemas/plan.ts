import { z } from "zod";
import { CourseId, ProgramId, Reason, ReasonCode, ResultVersions, Term, compareTerms } from "./common";
import { Section } from "./catalog";

/**
 * Plan: a term-by-term schedule toward the declared programs (planner.ts),
 * and PlanCheck: the result of validating any plan (validate.ts).
 *
 * A plan is never part of the AcademicRecord. It is computed FROM a record
 * (or a what-if copy of one), so regenerating or discarding a plan can't
 * change a fact about the student.
 */

/** One unit of requirement the planner must fill. */
export const RequirementSlot = z
  .strictObject({
    /** `${programId}/${requirementKey}#<part>`: the part is the course id for
     *  a fixed course, a number for a choice, "credits" for a credit pool.
     *  Stable across regenerations, so a lock still points at its slot. */
    slotId: z.string().min(1),
    programId: ProgramId,
    requirementKey: z.string().min(1),
    section: Section,
    /** course: one fixed course. choice: any ONE of courseIds. credits:
     *  `credits` credits from courseIds, or prose with no list (courseIds
     *  empty: an "approved elective" the plan reserves hours for). */
    kind: z.enum(["course", "choice", "credits"]),
    courseIds: z.array(CourseId),
    credits: z.number().nonnegative(),
    /** "Core Courses: COP 3503C", "Approved electives". */
    label: z.string().min(1),
  })
  .superRefine((s, ctx) => {
    if (s.kind === "course" && s.courseIds.length !== 1)
      ctx.addIssue({ code: "custom", path: ["courseIds"], message: "a course slot names exactly one course" });
    if (s.kind === "choice" && s.courseIds.length < 2)
      ctx.addIssue({ code: "custom", path: ["courseIds"], message: "a choice slot needs at least two options" });
  });
export type RequirementSlot = z.infer<typeof RequirementSlot>;

/** Why a course is in the plan. requirement: it fills slotIds. prerequisite:
 *  a planned course needs it. corequisite: taken with (or before) a planned
 *  course that requires it. tracking: a Critical Tracking milestone names
 *  it. locked: the student put it there. placeholder: hours reserved for a
 *  prose slot (courseId null). */
export const PlannedWhy = z.enum(["requirement", "prerequisite", "corequisite", "tracking", "locked", "placeholder"]);

export const PlannedCourse = z
  .strictObject({
    /** Null only for a placeholder. */
    courseId: CourseId.nullable(),
    /** "COP 3503C", or the placeholder's label. */
    label: z.string().min(1),
    why: PlannedWhy,
    /** Slots it fills; more than one where requirements of different
     *  programs or counting domains share it (as the audit allows). */
    slotIds: z.array(z.string().min(1)),
    credits: z.number().nonnegative(),
    /** Locked by the student: regeneration keeps it in this term. */
    locked: z.boolean(),
    /** confirmed: in the published Schedule of Courses for that term.
     *  historical: offered in that season in past terms, not yet published.
     *  unconfirmed: no evidence either way. Never presented as confirmed. */
    offering: z.enum(["confirmed", "historical", "unconfirmed"]),
    /** The Critical Tracking deadline it serves, if any. */
    deadline: Term.nullable(),
    /** What this placement assumes or risks (prerequisite unverified,
     *  offering unconfirmed, a variable-credit course at its minimum). */
    notes: z.array(Reason),
  })
  .superRefine((c, ctx) => {
    if ((c.courseId === null) !== (c.why === "placeholder"))
      ctx.addIssue({ code: "custom", path: ["courseId"], message: "exactly placeholders have no course" });
    if (c.why === "requirement" && c.slotIds.length === 0)
      ctx.addIssue({ code: "custom", path: ["slotIds"], message: "a requirement course names its slots" });
  });
export type PlannedCourse = z.infer<typeof PlannedCourse>;

export const PlanTerm = z.strictObject({
  term: Term,
  courses: z.array(PlannedCourse),
  credits: z.number().nonnegative(),
  creditCap: z.number().positive(),
  /** The whole term is locked (kept as-is on regeneration). */
  locked: z.boolean(),
});
export type PlanTerm = z.infer<typeof PlanTerm>;

/** A course the plan needed but couldn't place, and why. */
export const UnplacedCourse = z.strictObject({
  courseId: CourseId.nullable(),
  label: z.string().min(1),
  slotIds: z.array(z.string()),
  credits: z.number().nonnegative(),
  reasons: z.array(Reason).min(1),
});

/** What the caller asked for. Echoed in the plan so regeneration can reuse
 *  it. Course codes in `locks` may be any spelling. */
export const PlanOptions = z.strictObject({
  /** The term the student wants to graduate in (the last planned term). */
  targetTerm: Term,
  /** First planned term. Default: the next fall or spring after the
   *  record's current term. */
  startTerm: Term.optional(),
  /** Credits per term. Default 15: a planner default, not a UF rule. */
  creditCap: z.number().positive().max(30).optional(),
  termCaps: z.array(z.strictObject({ term: Term, credits: z.number().nonnegative().max(30) })).optional(),
  /** Credits each planned fall/spring term is assumed to total, for class
   *  standing only (unnamed hours are free electives). Default 12, UF's
   *  full-time load; 0 turns it off. */
  assumedTermLoad: z.number().nonnegative().max(30).optional(),
  /** Plan summer terms too. Default false. */
  summer: z.boolean().optional(),
  /** Courses pinned to a term. They survive regeneration. */
  locks: z.array(z.strictObject({ course: z.string().min(1), term: Term })).optional(),
  /** Terms kept exactly as locked: nothing is added to them. */
  lockedTerms: z.array(Term).optional(),
  /** Courses to pick first when a slot has a choice, best first (e.g. the
   *  recommendation ranking). Any spelling. */
  prefer: z.array(z.string().min(1)).optional(),
  /** Programs to plan for. Default: the record's declared programs. */
  programIds: z.array(ProgramId).optional(),
  planId: z.string().min(1).optional(),
});
export type PlanOptions = z.infer<typeof PlanOptions>;

export const Plan = z
  .strictObject({
    versions: ResultVersions,
    planId: z.string().min(1),
    programIds: z.array(ProgramId).min(1),
    /** record: built from the saved record and programs. what_if: built from a
     *  modified copy (other programs or catalog year); never saved over the
     *  record. */
    basis: z.enum(["record", "what_if"]),
    status: z.enum(["feasible", "infeasible"]),
    startTerm: Term,
    targetTerm: Term,
    terms: z.array(PlanTerm),
    /** Every slot the plan had to fill (the "why" a planned course points at). */
    slots: z.array(RequirementSlot),
    /** Slots no term could take. Empty when feasible. */
    unplacedSlots: z.array(RequirementSlot),
    /** Courses the plan needed but couldn't place. */
    unplacedCourses: z.array(UnplacedCourse),
    /** Why the plan is infeasible: the binding constraints, named. */
    blockers: z.array(Reason),
    /** What the plan assumes but nobody has confirmed (future offerings,
     *  passing grades, requirements that can't be planned). */
    assumptions: z.array(Reason),
    totals: z.strictObject({
      /** Credits the plan schedules (placeholders included). */
      planned: z.number().nonnegative(),
      /** Already earned, and in progress now (from the record). */
      earned: z.number().nonnegative(),
      inProgress: z.number().nonnegative(),
    }),
    options: PlanOptions,
  })
  .superRefine((p, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    const slotIds = new Set(p.slots.map((s) => s.slotId));
    if (slotIds.size !== p.slots.length) issue(["slots"], "slot ids are unique");
    let planned = 0;
    p.terms.forEach((t, i) => {
      const total = t.courses.reduce((s, c) => s + c.credits, 0);
      planned += total;
      if (Math.abs(total - t.credits) > 1e-9) issue(["terms", i, "credits"], "credits must sum the term's courses");
      if (i > 0 && compareTerms(p.terms[i - 1].term, t.term) >= 0)
        issue(["terms", i, "term"], "terms must be in calendar order without repeats");
      if (compareTerms(t.term, p.startTerm) < 0 || compareTerms(t.term, p.targetTerm) > 0)
        issue(["terms", i, "term"], "terms lie between startTerm and targetTerm");
      if (t.credits > t.creditCap + 1e-9 && !p.blockers.some((b) => b.code === "locked_conflict"))
        issue(["terms", i, "credits"], "over the credit cap only when a lock forces it (a locked_conflict blocker)");
      t.courses.forEach((c, j) => {
        for (const id of c.slotIds) if (!slotIds.has(id)) issue(["terms", i, "courses", j, "slotIds"], `unknown slot "${id}"`);
      });
    });
    if (Math.abs(planned - p.totals.planned) > 1e-9) issue(["totals", "planned"], "totals.planned sums the terms");
    const ids = p.terms.flatMap((t) => t.courses.map((c) => c.courseId)).filter((c) => c !== null);
    if (new Set(ids).size !== ids.length) issue(["terms"], "a course is planned once");
    if (p.status === "infeasible" && p.blockers.length === 0)
      issue(["blockers"], "an infeasible plan must name its blocker");
    if (p.status === "feasible" && (p.unplacedSlots.length || p.unplacedCourses.length || p.blockers.length))
      issue(["status"], "a feasible plan places every slot and course and has no blocker");
  });
export type Plan = z.infer<typeof Plan>;

// ---------------------------------------------------------------------------
// Validation of any plan (a generated one, or one a student or advisor made)
// ---------------------------------------------------------------------------

/** The minimum a plan to validate needs: terms and their course codes. A
 *  generated Plan converts with `draftOf`. */
export const PlanDraft = z.strictObject({
  terms: z.array(z.strictObject({ term: Term, courses: z.array(z.string().min(1)) })),
  creditCap: z.number().positive().max(30).optional(),
  /** As in PlanOptions. Default 12. */
  assumedTermLoad: z.number().nonnegative().max(30).optional(),
  programIds: z.array(ProgramId).optional(),
});
export type PlanDraft = z.infer<typeof PlanDraft>;

export const PlanIssue = z.strictObject({
  /** error: the plan can't work as written. warning: it rests on something
   *  unconfirmed. */
  severity: z.enum(["error", "warning"]),
  code: ReasonCode,
  message: z.string().min(1),
  term: Term.optional(),
  courseIds: z.array(CourseId).optional(),
});
export type PlanIssue = z.infer<typeof PlanIssue>;

export const PlanCheck = z
  .strictObject({
    versions: ResultVersions,
    /** No error-severity issue. */
    valid: z.boolean(),
    issues: z.array(PlanIssue),
    /** Each program as it would stand once every planned course is passed. */
    programsAfter: z.array(
      z.strictObject({
        programId: ProgramId,
        overallStatus: z.enum(["satisfied", "in_progress", "not_satisfied", "unknown"]),
        remainingCredits: z.number().nonnegative().nullable(),
        /** Requirements still not satisfied after the plan. */
        open: z.array(z.strictObject({ requirementKey: z.string(), name: z.string(), status: z.enum(["not_satisfied", "unknown"]) })),
      }),
    ),
  })
  .refine((c) => c.valid === !c.issues.some((i) => i.severity === "error"), "valid exactly when no issue is an error");
export type PlanCheck = z.infer<typeof PlanCheck>;
