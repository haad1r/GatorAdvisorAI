import { auditProgramDetailed, gpaResults } from "./audit";
import { CourseHistory, displayCode } from "./history";
import { compareTerms } from "./schemas/common";
import type { Catalog } from "./schemas/catalog";
import type { AcademicRecord } from "./schemas/record";
import type { AuditResult } from "./schemas/results";
import { StudentAudit, StudentTracking } from "./schemas/student";
import { evaluateTracking } from "./tracking";
import { resultVersions } from "./versions";

/**
 * The whole student: every declared program audited and tracked, plus what
 * only makes sense across programs (credit held, courses counting twice,
 * the soonest tracking deadline). Built from the per-program engines; no
 * rule is decided here.
 */

/** Declared program ids in record order, without repeats. Throws for an id
 *  the catalog doesn't have: auditing a program that doesn't exist would
 *  report it as "not satisfied". */
export function declaredPrograms(catalog: Catalog, record: AcademicRecord): string[] {
  const ids = [...new Set(record.programs.map((p) => p.programId))];
  for (const id of ids) if (!catalog.programs[id]) throw new RangeError(`the record declares unknown program "${id}"`);
  return ids;
}

export function auditStudent(
  catalog: Catalog,
  record: AcademicRecord,
  history: CourseHistory = new CourseHistory(record, catalog),
): StudentAudit {
  const audits = declaredPrograms(catalog, record).map((id) => auditProgramDetailed(catalog, record, id, history).result);
  const earned = history.earnedByCourse();
  const sum = (hs: { credits: number }[]) => hs.reduce((s, h) => s + h.credits, 0);

  return StudentAudit.parse({
    versions: resultVersions(catalog, record),
    programs: audits,
    credits: {
      earned: sum(earned.completed) + history.electiveCredits(),
      inProgress: sum(earned.pending),
    },
    gpa: gpaResults(history, ["uf_cumulative", "upper_division"]),
    sharedCourses: sharedCourses(catalog, audits),
    unknowns: audits.flatMap((a): StudentAudit["unknowns"] =>
      a.programStatus === "needs_review"
        ? [{ programId: a.programId, requirementKey: null, name: a.programName, reasons: a.reasons }]
        : a.requirements
            .filter((r) => r.countsTowardDegree && r.status === "unknown")
            .map((r) => ({ programId: a.programId, requirementKey: r.requirementKey, name: r.name, reasons: r.reasons })),
    ),
  });
}

function sharedCourses(catalog: Catalog, audits: readonly AuditResult[]): StudentAudit["sharedCourses"] {
  const where = new Map<string, StudentAudit["sharedCourses"][number]["countedIn"]>();
  for (const a of audits)
    for (const r of a.requirements) {
      if (!r.countsTowardDegree) continue;
      for (const [courses, pending] of [[r.appliedCourses, false], [r.pendingCourses, true]] as const)
        for (const c of courses) {
          const list = where.get(c.courseId) ?? [];
          list.push({ programId: a.programId, requirementKey: r.requirementKey, name: r.name, section: r.section, pending });
          where.set(c.courseId, list);
        }
    }
  return [...where]
    .filter(([, countedIn]) => countedIn.length >= 2)
    .map(([courseId, countedIn]) => ({ courseId, code: displayCode(catalog, courseId), countedIn }));
}

export function trackStudent(
  catalog: Catalog,
  record: AcademicRecord,
  history: CourseHistory = new CourseHistory(record, catalog),
): StudentTracking {
  const programs: StudentTracking["programs"] = [];
  const untracked: StudentTracking["untracked"] = [];
  for (const id of declaredPrograms(catalog, record)) {
    const p = catalog.programs[id];
    if (p.milestones.length === 0)
      untracked.push({ programId: id, reason: `The ${p.name} ${p.kind} publishes no Critical Tracking milestones.` });
    else programs.push(evaluateTracking(catalog, record, id, history));
  }
  const next = programs
    .filter((t) => t.nextDeadline)
    .map((t) => ({ programId: t.programId, semester: t.nextDeadline!.semester, term: t.nextDeadline!.term }))
    .sort((a, b) => compareTerms(a.term, b.term))[0];
  return StudentTracking.parse({
    versions: resultVersions(catalog, record),
    programs,
    untracked,
    nextDeadline: next ?? null,
  });
}
