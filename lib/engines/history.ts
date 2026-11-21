import type { Catalog } from "./schemas/catalog";
import type { AcademicRecord, Grade } from "./schemas/record";
import type { TakenStatus } from "./schemas/results";
import { type RequisiteValue, combineOr } from "./status";

/**
 * What a record says about courses, read once and shared by every engine.
 * The grade rules (UF grading policy, see schemas/record.ts) live only here,
 * so the audit, eligibility and tracking engines can't disagree about
 * whether a D counts or how a repeat is credited.
 */

/** UF grade points. Null: not computed in the GPA (S, U, W, H, I*, N*). */
export const GRADE_POINTS: Record<Grade, number | null> = {
  A: 4, "A-": 3.67, "B+": 3.33, B: 3, "B-": 2.67, "C+": 2.33, C: 2, "C-": 1.67,
  "D+": 1.33, D: 1, "D-": 0.67, E: 0, WF: 0, I: 0, NG: 0,
  S: null, U: null, W: null, H: null, "I*": null, "N*": null,
};

/** Grades that earn the course's credit. D grades earn credit at UF; a
 *  requirement or prerequisite that needs more says so with a minimum. */
const PASSING: ReadonlySet<Grade> = new Set([
  "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "S",
]);

/** UF: "A grade of S is equal to a C (2.0) or better." */
const S_EQUALS = 2;

/** Does `grade` meet a minimum? No minimum means any passing grade. `orS`
 *  is the catalog saying an S is accepted outright. */
export function meetsMinimum(grade: Grade, min?: Grade, orS?: boolean): boolean {
  if (!PASSING.has(grade)) return false;
  if (!min) return true;
  if (grade === "S") return orS === true || (GRADE_POINTS[min] ?? 0) <= S_EQUALS;
  return (GRADE_POINTS[grade] ?? 0) + 1e-9 >= (GRADE_POINTS[min] ?? 0);
}

/** One way the record holds a course: an attempt or an exam award. */
export type Holding = {
  entryId: string;
  courseId: string;
  credits: number;
  value: RequisiteValue;
  /** For an unknown holding: why. */
  missingGrade?: boolean;
};

/** "gly2010c" -> "GLY 2010C", for ids the catalog doesn't know. */
export function displayCode(catalog: Catalog, courseId: string): string {
  return catalog.courses[courseId]?.code ?? `${courseId.slice(0, 3)} ${courseId.slice(3)}`.toUpperCase();
}

/** The course number's level: "gly4155c" -> 4000. */
export const courseLevel = (courseId: string) => Number(courseId[3]) * 1000;

export class CourseHistory {
  constructor(
    readonly record: AcademicRecord,
    readonly catalog: Catalog,
  ) {}

  /** Every holding of a course, judged against an optional minimum grade.
   *  completed + meets the minimum: met. completed, no grade: unknown.
   *  in progress: pending. Exam credit: met (it carries no grade, and UF
   *  accepts it where it awards the course). Failing attempts are skipped,
   *  so a repeat's later passing grade decides, as UF's policy has it. */
  holdings(courseId: string, min?: Grade, orS?: boolean): Holding[] {
    const out: Holding[] = [];
    for (const a of this.record.attempts) {
      if (a.courseId !== courseId) continue;
      const base = { entryId: a.attemptId, courseId, credits: a.credits };
      if (a.status === "in_progress") out.push({ ...base, value: "pending" });
      else if (!a.grade) out.push({ ...base, value: "unknown", missingGrade: true });
      else if (meetsMinimum(a.grade, min, orS)) out.push({ ...base, value: "met" });
    }
    for (const e of this.record.examCredits)
      if (e.courseIds.includes(courseId))
        out.push({ entryId: e.examCreditId, courseId, credits: this.examCredits(e, courseId), value: "met" });
    return out;
  }

  /** An award of one course carries its own hours. One that grants several
   *  (CHM 2045 + 2045L for 4) is split by the courses' catalog credits, so
   *  the lecture isn't credited with the lab's hour. */
  private examCredits(e: AcademicRecord["examCredits"][number], courseId: string): number {
    if (e.courseIds.length === 1) return e.credits;
    return this.catalog.courses[courseId]?.creditsMin ?? e.credits / e.courseIds.length;
  }

  /** The best standing on a course and the entries that give it. */
  best(courseId: string, min?: Grade, orS?: boolean): { value: RequisiteValue; holdings: Holding[] } {
    const hs = this.holdings(courseId, min, orS);
    const value = combineOr(hs.map((h) => h.value));
    return { value, holdings: hs.filter((h) => h.value === value) };
  }

  /** Credit earned per course, awarded once (UF: a repeat's credit counts
   *  once), as one holding per course: the completed passing attempt or exam
   *  award with the most credits, the latest on a tie. In-progress courses not already earned are
   *  returned separately. Elective credit has no course and is not here. */
  earnedByCourse(): { completed: Holding[]; pending: Holding[] } {
    const completed = new Map<string, Holding>();
    const pending = new Map<string, Holding>();
    const ids = new Set([
      ...this.record.attempts.map((a) => a.courseId),
      ...this.record.examCredits.flatMap((e) => e.courseIds),
    ]);
    for (const id of ids) {
      const hs = this.holdings(id);
      // The most credits; on a tie the latest entry (a repeat's own row).
      const done = hs.filter((h) => h.value === "met").reduce<Holding | undefined>(
        (best, h) => (!best || h.credits >= best.credits ? h : best),
        undefined,
      );
      if (done) completed.set(id, done);
      else {
        const now = hs.find((h) => h.value === "pending");
        if (now) pending.set(id, now);
      }
    }
    return { completed: [...completed.values()], pending: [...pending.values()] };
  }

  /** Has the student already taken the course? passed: a completed attempt
   *  with a passing grade, or exam credit. in_progress: enrolled now.
   *  no_grade: completed, grade not recorded (may have passed). not_passed:
   *  every attempt failed or was withdrawn (a retake is possible). none: no
   *  attempt. The most decided status wins, in that order. */
  taken(courseId: string): { status: TakenStatus; evidenceIds: string[] } {
    const hs = this.holdings(courseId);
    for (const [status, value] of [["passed", "met"], ["in_progress", "pending"], ["no_grade", "unknown"]] as const) {
      const hit = hs.filter((h) => h.value === value);
      if (hit.length) return { status, evidenceIds: hit.map((h) => h.entryId) };
    }
    const tried = this.record.attempts.filter((a) => a.courseId === courseId);
    return tried.length
      ? { status: "not_passed", evidenceIds: tried.map((a) => a.attemptId) }
      : { status: "none", evidenceIds: [] };
  }

  /** Hours with no course attached (UF elective placeholders). */
  electiveCredits(): number {
    return this.record.electiveCredits.reduce((s, e) => s + e.credits, 0);
  }

  /** UF cumulative GPA: UF attempts only (transfer and dual-enrollment
   *  grades are never averaged in), every attempt of a repeat, grades with
   *  points only. Null value when there are no GPA hours. */
  ufCumulativeGpa(): { value: number | null; gradePoints: number; gpaHours: number; attemptIds: string[] } {
    let gradePoints = 0;
    let gpaHours = 0;
    const attemptIds: string[] = [];
    for (const a of this.record.attempts) {
      if (a.source !== "uf" || a.status !== "completed" || !a.grade) continue;
      const gp = GRADE_POINTS[a.grade];
      if (gp === null) continue;
      gradePoints += gp * a.credits;
      gpaHours += a.credits;
      attemptIds.push(a.attemptId);
    }
    const value = gpaHours ? Math.round((gradePoints / gpaHours) * 100) / 100 : null;
    return { value, gradePoints, gpaHours, attemptIds };
  }
}
