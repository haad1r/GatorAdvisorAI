import { CourseHistory, type Holding, displayCode } from "../history";
import type { Catalog } from "../schemas/catalog";
import type { AcademicRecord } from "../schemas/record";
import type { AppliedCourse } from "../schemas/results";

/**
 * What the student holds, one entry per course, for the audit to spend.
 *
 * A course is held once even if attempted twice (UF awards the credit once;
 * history.ts picks the attempt). Completed beats in progress: a student
 * retaking a course they already passed still holds it as completed.
 */

export type Held = {
  courseId: string;
  state: "completed" | "pending";
  holding: Holding;
  /** Set when an advisor exception makes this course count (see
   *  substitutions in ./README.md). */
  exceptionId?: string;
};

export type Holdings = {
  /** courseId -> the student's holding of it. */
  byCourse: Map<string, Held>;
  /** Courses with a completed attempt but no grade, and nothing better:
   *  they may count, so a group they would fill is unknown, not unmet. */
  ungraded: Set<string>;
  /** Completed courses in record order, for unappliedCourses. */
  completed: Held[];
};

export function holdingsOf(history: CourseHistory): Holdings {
  const byCourse = new Map<string, Held>();
  const earned = history.earnedByCourse();
  // Record order of the entry that counts (a repeat sits where its passing
  // attempt does), exam credit after attempts.
  const record = history.record;
  const position = (entryId: string) => {
    const i = record.attempts.findIndex((a) => a.attemptId === entryId);
    return i >= 0 ? i : record.attempts.length + record.examCredits.findIndex((e) => e.examCreditId === entryId);
  };
  const completed = earned.completed
    .map((h): Held => ({ courseId: h.courseId, state: "completed", holding: h }))
    .sort((a, b) => position(a.holding.entryId) - position(b.holding.entryId));
  for (const h of completed) byCourse.set(h.courseId, h);
  for (const h of earned.pending) byCourse.set(h.courseId, { courseId: h.courseId, state: "pending", holding: h });
  const ungraded = new Set(
    record.attempts
      .filter((a) => a.status === "completed" && !a.grade && !byCourse.has(a.courseId))
      .map((a) => a.courseId),
  );
  return { byCourse, ungraded, completed };
}

/** The evidence for one counted course: the record entry behind it, its
 *  grade and term when it is an attempt. */
export function appliedCourse(catalog: Catalog, record: AcademicRecord, held: Held): AppliedCourse {
  const attempt = record.attempts.find((a) => a.attemptId === held.holding.entryId);
  const base = {
    courseId: held.courseId,
    code: displayCode(catalog, held.courseId),
    credits: held.holding.credits,
    evidenceId: held.exceptionId ?? held.holding.entryId,
  };
  if (!attempt) return { ...base, via: held.exceptionId ? "substitution" : "exam" };
  return {
    ...base,
    via: held.exceptionId ? "substitution" : attempt.source,
    ...(attempt.grade ? { grade: attempt.grade } : {}),
    ...(attempt.term ? { term: attempt.term } : {}),
  };
}
