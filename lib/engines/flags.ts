import { auditProgramDetailed } from "./audit";
import { evaluateEligibility } from "./eligibility";
import { CourseHistory, displayCode } from "./history";
import { type Reason, type Term, nextRegularTerm, parseCourseId, toCourseId } from "./schemas/common";
import type { Catalog } from "./schemas/catalog";
import type { AcademicRecord } from "./schemas/record";
import {
  type CandidateCourse,
  CandidateFilter,
  type CourseFlags,
  type Flag,
  RequirementFlags,
} from "./schemas/student";
import { declaredPrograms } from "./student";
import { resultVersions } from "./versions";

/**
 * The two inputs recommendation scoring needs (issue #11, scoring_v1), kept
 * as separate steps because scoring doesn't filter:
 *
 *   filterCandidates(...)  the hard filter: eligibility, already taken,
 *                          offered in the term. Run first.
 *   requirementFlags(...)  per course: does it fill an open requirement /
 *                          an open major requirement? Read off the audit.
 *
 * Course codes may be given in any spelling ("STA 3100", "sta3100").
 */

// ---------------------------------------------------------------------------
// Requirement flags
// ---------------------------------------------------------------------------

export function requirementFlags(
  catalog: Catalog,
  record: AcademicRecord,
  courses: readonly string[],
  history: CourseHistory = new CourseHistory(record, catalog),
): RequirementFlags {
  const ids = courses.map(toCourseId);
  const audits = declaredPrograms(catalog, record).map((id) => ({
    program: catalog.programs[id],
    ...auditProgramDetailed(catalog, record, id, history),
  }));

  // Open requirements (not_satisfied / unknown, counting toward the degree)
  // indexed by the courses that could still fill them.
  const openBy = new Map<string, CourseFlags["requirements"]>();
  let proseSlots = 0;
  for (const { program, result, remaining } of audits)
    for (const r of result.requirements) {
      if (!r.countsTowardDegree || (r.status !== "not_satisfied" && r.status !== "unknown")) continue;
      proseSlots += r.remainingOptions.openSlots.length;
      const entry = { programId: program.id, programKind: program.kind, requirementKey: r.requirementKey, name: r.name, section: r.section, status: r.status };
      for (const id of remaining.get(r.requirementKey) ?? []) openBy.set(id, [...(openBy.get(id) ?? []), entry]);
    }

  const flagOf = (rs: CourseFlags["requirements"]): Flag =>
    rs.some((r) => r.status === "not_satisfied") ? "yes" : rs.some((r) => r.status === "unknown") ? "unknown" : "no";

  const flags = ids.map((courseId): CourseFlags => {
    const code = displayCode(catalog, courseId);
    const taken = history.taken(courseId);
    if (taken.status === "passed" || taken.status === "in_progress")
      return {
        courseId, code, fillsRequirement: "no", fillsMajorSlot: "no", requirements: [],
        reasons: [{ code: "already_held", message: `${code} is already ${taken.status === "passed" ? "completed" : "in progress"}; the audit counts it where it applies.`, courseIds: [courseId] }],
      };
    const requirements = openBy.get(courseId) ?? [];
    const major = requirements.filter((r) => r.programKind === "major" && r.section === "major");
    const reasons: Reason[] = [];
    if (requirements.some((r) => r.status === "unknown") && !requirements.some((r) => r.status === "not_satisfied"))
      reasons.push({ code: "rule_not_modeled", message: `${code} is listed only for requirements the audit can't decide; see each requirement's reasons.`, courseIds: [courseId] });
    return { courseId, code, fillsRequirement: flagOf(requirements), fillsMajorSlot: flagOf(major), requirements, reasons };
  });

  const caveats: Reason[] = [];
  if (proseSlots)
    caveats.push({
      code: "rule_not_modeled",
      message: `${proseSlots} open requirement slot(s) are prose ("approved elective") with no course list, so no course is flagged for them; a course may still count there with an advisor's approval.`,
    });
  return RequirementFlags.parse({ versions: resultVersions(catalog, record), courses: flags, caveats });
}

/** The scoring baseline's two booleans (scoring.ts `Course`). Only a "yes"
 *  is true: an unknown never boosts a score, as "never treat unknown as OK"
 *  requires. Keep `CourseFlags` itself when the reason should be shown. */
export function toScoringFlags(f: CourseFlags): { fillsRequirement: boolean; fillsMajorSlot: boolean } {
  return { fillsRequirement: f.fillsRequirement === "yes", fillsMajorSlot: f.fillsMajorSlot === "yes" };
}

// ---------------------------------------------------------------------------
// Candidate filter
// ---------------------------------------------------------------------------

/** Which courses may be recommended for `term` (default: the next fall or
 *  spring). One decision per input, in input order. Eligibility comes from
 *  evaluateEligibility, the only place it is decided. */
export function filterCandidates(
  catalog: Catalog,
  record: AcademicRecord,
  courses: readonly string[],
  term: Term = nextRegularTerm(record.currentTerm),
  history: CourseHistory = new CourseHistory(record, catalog),
): CandidateFilter {
  const decide = (input: string): CandidateCourse => {
    const courseId = parseCourseId(input);
    const none = { courseId, input, eligibility: null, taken: null, offering: null };
    if (courseId === null)
      return { ...none, decision: "excluded", reasons: [{ code: "unknown_course", message: `"${input}" isn't a course code.` }] };
    if (!catalog.courses[courseId])
      return { ...none, decision: "excluded", reasons: [{ code: "unknown_course", message: `${displayCode(catalog, courseId)} isn't in the catalog or the Schedule of Courses.`, courseIds: [courseId] }] };

    const e = evaluateEligibility(catalog, record, courseId, term, {}, history);
    const base = { courseId, input, eligibility: e.status, taken: e.taken.status, offering: e.offering.status };
    const code = displayCode(catalog, courseId);
    const out = (decision: CandidateCourse["decision"], reasons: Reason[]): CandidateCourse => ({ ...base, decision, reasons });

    if (e.taken.status === "passed" || e.taken.status === "in_progress")
      return out("excluded", [{ code: "already_held", message: `${code} is already ${e.taken.status === "passed" ? "completed" : "in progress"}.`, courseIds: [courseId] }]);
    if (e.status === "not_eligible") return out("excluded", e.reasons);
    if (e.offering.status === "not_scheduled") return out("excluded", [{ code: "not_offered", message: e.offering.message, courseIds: [courseId] }]);

    const check: Reason[] = [];
    if (e.taken.status === "no_grade")
      check.push({ code: "missing_grade", message: `${code} was completed with no grade on record; it may already be passed.`, courseIds: [courseId] });
    if (e.status === "unknown") check.push(...e.reasons);
    if (e.offering.status === "unknown" || e.offering.status === "not_seen")
      check.push({ code: "offering_unconfirmed", message: e.offering.message, courseIds: [courseId] });
    if (check.length) return out("needs_check", check);

    // A candidate still says what it rests on.
    const notes: Reason[] = [...(e.status === "eligible_pending" ? e.reasons : [])];
    if (e.offering.status === "historical") notes.push({ code: "offering_unconfirmed", message: e.offering.message, courseIds: [courseId] });
    return out("candidate", notes);
  };

  return CandidateFilter.parse({ versions: resultVersions(catalog, record), term, courses: courses.map(decide) });
}
