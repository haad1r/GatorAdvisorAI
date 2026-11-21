import { z } from "zod";

/**
 * Status vocabularies and the rules that combine them.
 *
 * These live in one file, outside the schemas, because they are academic
 * rules: the engines use them to PRODUCE results and the schemas use them to
 * CHECK results, and the two must never disagree. Each combine function
 * ranks statuses and takes the "worst" (or, for OR, the "best").
 */

// ---------------------------------------------------------------------------
// Requirements and programs (audit)
// ---------------------------------------------------------------------------

/** satisfied: met by completed work alone.
 *  in_progress: met only if currently enrolled courses are passed.
 *  not_satisfied: short even counting current enrollment.
 *  unknown: cannot be decided from the data and record (reasons say why). */
export const RequirementStatus = z.enum(["satisfied", "in_progress", "not_satisfied", "unknown"]);
export type RequirementStatus = z.infer<typeof RequirementStatus>;

/** not_satisfied outranks unknown: when one requirement is definitely unmet
 *  and another can't be checked, "not met" is true and more useful. */
const REQUIREMENT_RANK: Record<RequirementStatus, number> = {
  satisfied: 0,
  in_progress: 1,
  unknown: 2,
  not_satisfied: 3,
};

/** The program's overall status from its requirements' statuses (only those
 *  that count toward the degree; "options" groups never block). A program
 *  that needs review can be no better than unknown. Nothing to judge is
 *  unknown, never satisfied. */
export function combineRequirementStatuses(
  statuses: readonly RequirementStatus[],
  programNeedsReview: boolean,
): RequirementStatus {
  const all = programNeedsReview ? [...statuses, "unknown" as const] : statuses;
  if (all.length === 0) return "unknown";
  return all.reduce((worst, s) => (REQUIREMENT_RANK[s] > REQUIREMENT_RANK[worst] ? s : worst));
}

// ---------------------------------------------------------------------------
// Requisites (eligibility)
// ---------------------------------------------------------------------------

/** The value of one requisite node: met by completed work, pending on
 *  current enrollment, not met, or unknown (permission, placement, unparsed
 *  text, a fact the record lacks). */
export const RequisiteValue = z.enum(["met", "pending", "not_met", "unknown"]);
export type RequisiteValue = z.infer<typeof RequisiteValue>;

/** One scale for both combinators: AND takes the worst child, OR the best.
 *  So in an AND, not_met beats unknown (one missing course settles it,
 *  whatever the unknown branch would have said); in an OR, pending beats
 *  unknown (a route that will be met if a current course is passed is the
 *  most certain answer available). */
const VALUE_RANK: Record<RequisiteValue, number> = { met: 0, pending: 1, unknown: 2, not_met: 3 };

export function combineAnd(values: readonly RequisiteValue[]): RequisiteValue {
  return values.reduce<RequisiteValue>((w, v) => (VALUE_RANK[v] > VALUE_RANK[w] ? v : w), "met");
}

export function combineOr(values: readonly RequisiteValue[]): RequisiteValue {
  return values.reduce<RequisiteValue>((b, v) => (VALUE_RANK[v] < VALUE_RANK[b] ? v : b), "not_met");
}

/** eligible: requisites met by completed work.
 *  eligible_pending: met only if current courses are passed (UF lets a
 *    student register with prerequisites in progress).
 *  not_eligible: a requisite is definitely unmet.
 *  unknown: cannot be decided; never silently treated as eligible. */
export const EligibilityStatus = z.enum(["eligible", "eligible_pending", "not_eligible", "unknown"]);
export type EligibilityStatus = z.infer<typeof EligibilityStatus>;

export const ELIGIBILITY_OF: Record<RequisiteValue, EligibilityStatus> = {
  met: "eligible",
  pending: "eligible_pending",
  not_met: "not_eligible",
  unknown: "unknown",
};

// ---------------------------------------------------------------------------
// Critical Tracking
// ---------------------------------------------------------------------------

/** One milestone. met: completed work satisfies it. pending: satisfied only
 *  if current courses are passed. upcoming: not yet satisfied and its
 *  semester is still ahead. not_met: its semester is now or past and even
 *  current enrollment doesn't satisfy it. unknown: due now or past, and it
 *  can't be checked (a prose-only row, a GPA rule the data doesn't encode). */
export const MilestoneStatus = z.enum(["met", "pending", "upcoming", "not_met", "unknown"]);
export type MilestoneStatus = z.infer<typeof MilestoneStatus>;

/** The program's tracking state, in the issue's four words. */
export const TrackingStatus = z.enum(["met", "at_risk", "not_met", "unknown"]);
export type TrackingStatus = z.infer<typeof TrackingStatus>;

/** not_met if any milestone is missed; else unknown if any due milestone
 *  can't be checked; else at_risk if a due milestone rests on current
 *  courses; else met. Upcoming milestones don't change the answer: being in
 *  semester 3 with a semester-5 course untaken is normal, not a risk. */
export function combineMilestones(
  milestones: readonly { semester: number; status: MilestoneStatus }[],
  currentSemester: number,
): TrackingStatus {
  const due = milestones.filter((m) => m.semester <= currentSemester);
  if (milestones.some((m) => m.status === "not_met")) return "not_met";
  if (due.some((m) => m.status === "unknown")) return "unknown";
  if (due.some((m) => m.status === "pending")) return "at_risk";
  return "met";
}
