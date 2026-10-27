import { z } from "zod";
import { CourseId, ProgramId, Reason, ResultVersions, Term, compareTerms } from "./common";

/**
 * Plan: a term-by-term schedule toward the declared programs. DRAFT for
 * checkpoint 3 (the planner); published now so consumers can agree on it.
 *
 * A plan is never part of the AcademicRecord. It is computed FROM a record
 * (or a what-if copy of one), so regenerating or discarding a plan can't
 * change a fact about the student.
 */

/** One unit of requirement the planner must fill. */
export const RequirementSlot = z
  .strictObject({
    /** `${programId}/${requirementKey}#${n}`, stable across regenerations so
     *  a locked choice still points at the same slot. */
    slotId: z.string().min(1),
    programId: ProgramId,
    requirementKey: z.string().min(1),
    /** course: one fixed course. choice: any ONE of courseIds. credits: N
     *  credits from courseIds, or an open slot when courseIds is empty. */
    kind: z.enum(["course", "choice", "credits"]),
    courseIds: z.array(CourseId),
    credits: z.number().nonnegative(),
    /** "GLY courses (3000/4000 level)", "Approved elective". */
    label: z.string().min(1),
  })
  .superRefine((s, ctx) => {
    if (s.kind === "course" && s.courseIds.length !== 1)
      ctx.addIssue({ code: "custom", path: ["courseIds"], message: "a course slot names exactly one course" });
    if (s.kind === "choice" && s.courseIds.length < 2)
      ctx.addIssue({ code: "custom", path: ["courseIds"], message: "a choice slot needs at least two options" });
  });
export type RequirementSlot = z.infer<typeof RequirementSlot>;

export const PlannedCourse = z.strictObject({
  /** Null: the slot is reserved but the student hasn't picked a course. */
  courseId: CourseId.nullable(),
  /** Slots it fills; more than one only where overlap is allowed. */
  slotIds: z.array(z.string().min(1)),
  credits: z.number().nonnegative(),
  /** Locked by the student: regeneration keeps it in this term. */
  locked: z.boolean(),
  /** confirmed: in the published Schedule of Courses for that term.
   *  historical: offered in that season in past terms, not yet published.
   *  unconfirmed: no evidence either way. Never presented as confirmed. */
  offering: z.enum(["confirmed", "historical", "unconfirmed"]),
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
    terms: z.array(PlanTerm),
    /** Slots no term could take. Empty when feasible. */
    unplacedSlots: z.array(RequirementSlot),
    /** Why the plan is infeasible: the binding constraint, named. */
    blockers: z.array(Reason),
    /** What the plan assumes but nobody has confirmed (future offerings). */
    assumptions: z.array(Reason),
  })
  .superRefine((p, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    p.terms.forEach((t, i) => {
      const total = t.courses.reduce((s, c) => s + c.credits, 0);
      if (Math.abs(total - t.credits) > 1e-9) issue(["terms", i, "credits"], "credits must sum the term's courses");
      if (i > 0 && compareTerms(p.terms[i - 1].term, t.term) >= 0)
        issue(["terms", i, "term"], "terms must be in calendar order without repeats");
    });
    if (p.status === "infeasible" && p.blockers.length === 0)
      issue(["blockers"], "an infeasible plan must name its blocker");
    if (p.status === "feasible" && p.unplacedSlots.length > 0)
      issue(["unplacedSlots"], "a feasible plan places every slot");
  });
export type Plan = z.infer<typeof Plan>;
