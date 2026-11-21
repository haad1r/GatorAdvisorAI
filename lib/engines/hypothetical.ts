import { type Term, compareTerms, termCode } from "./schemas/common";
import { AcademicRecord, type CourseAttempt } from "./schemas/record";

/**
 * The record as it would stand at the START of a future term, if every
 * course planned before it were passed. The planner and the plan validator
 * evaluate prerequisites against it with the one eligibility engine, so a
 * plan is checked by the same rules as a registration.
 *
 * Assumed-passed courses are entered as attempts with source "transfer"
 * and grade A: transfer grades are never averaged into the UF GPA, so the
 * assumption can't inflate a GPA requisite, while the credit still counts
 * toward standing and an A meets any minimum grade. That a planned course
 * is passed with the grade its successors need is the plan's assumption
 * (stated in every plan), not a fact.
 *
 * Never saved: these records exist only inside one evaluation.
 */

export type PlannedEntry = { courseId: string; term: Term; credits: number };

/** Credits a planned fall or spring term is assumed to total, for class
 *  standing: a plan names only requirement courses, and the rest of a
 *  normal load is free electives it doesn't name. 12 is UF's full-time
 *  load; 0 turns the assumption off. */
export const ASSUMED_TERM_LOAD = 12;

export type LoadAssumption = { terms: readonly Term[]; credits: number };

export const ASSUMED_INSTITUTION = "Assumed passed (plan)";

/** The calendar term just before `t` (summer included). */
export function previousTerm(t: Term): Term {
  if (t.season === "spring") return { season: "fall", year: t.year - 1 };
  if (t.season === "summer") return { season: "spring", year: t.year };
  return { season: "summer", year: t.year };
}

const assumed = (courseId: string, credits: number, id: string): CourseAttempt => ({
  attemptId: id,
  courseId,
  status: "completed",
  grade: "A",
  credits,
  source: "transfer",
  institution: ASSUMED_INSTITUTION,
});

/** `record` as of the start of `term`. Courses in progress now, and
 *  planned courses before the term just before `term`, count as passed;
 *  planned courses in the term just before it are in progress. */
export function recordAtStartOf(
  record: AcademicRecord,
  planned: readonly PlannedEntry[],
  term: Term,
  load: LoadAssumption = { terms: [], credits: 0 },
): AcademicRecord {
  const current = previousTerm(term);
  if (compareTerms(current, record.currentTerm) <= 0) return record;
  // Planned fall/spring terms already over, topped up to the assumed load
  // with unnamed elective hours (standing only counts hours).
  const electiveCredits = [...record.electiveCredits];
  for (const t of load.terms) {
    if (t.season === "summer" || compareTerms(t, current) >= 0 || compareTerms(t, record.currentTerm) <= 0) continue;
    const named = planned.filter((p) => compareTerms(p.term, t) === 0).reduce((n, p) => n + p.credits, 0);
    if (named < load.credits)
      electiveCredits.push({ entryId: `plan:load:${termCode(t)}`, label: `Assumed other coursework, ${t.season} ${t.year} (plan)`, credits: load.credits - named, source: "transfer", institution: ASSUMED_INSTITUTION });
  }
  const attempts: CourseAttempt[] = record.attempts.map((a) =>
    a.status === "in_progress" ? assumed(a.courseId, a.credits, a.attemptId) : a,
  );
  for (const p of planned) {
    const order = compareTerms(p.term, current);
    const id = `plan:${p.courseId}:${termCode(p.term)}`;
    if (order < 0) attempts.push(assumed(p.courseId, p.credits, id));
    else if (order === 0) attempts.push({ attemptId: id, courseId: p.courseId, status: "in_progress", credits: p.credits, source: "uf", term: p.term });
  }
  return AcademicRecord.parse({ ...record, currentTerm: current, attempts, electiveCredits, recordVersion: `${record.recordVersion}+plan` });
}

/** The record once every planned course is passed (for "what is left
 *  after this plan?"). */
export function recordAfter(record: AcademicRecord, planned: readonly PlannedEntry[], last: Term, load?: LoadAssumption): AcademicRecord {
  // Two calendar terms on, so the term before it is past `last` and every
  // planned course (and every current one) counts as completed.
  const from = compareTerms(last, record.currentTerm) > 0 ? last : record.currentTerm;
  return recordAtStartOf(record, planned, nextTerm(nextTerm(from)), load);
}

/** The calendar term just after `t` (summer included). */
export function nextTerm(t: Term): Term {
  if (t.season === "spring") return { season: "summer", year: t.year };
  if (t.season === "summer") return { season: "fall", year: t.year };
  return { season: "spring", year: t.year + 1 };
}
