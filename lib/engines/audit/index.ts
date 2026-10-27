import { CourseHistory } from "../history";
import type { Reason, SourceReference } from "../schemas/common";
import type { Catalog, Program, RequirementGroup } from "../schemas/catalog";
import type { AcademicRecord } from "../schemas/record";
import { AuditResult, type GpaResult, type RequirementResult } from "../schemas/results";
import { type RequirementStatus, type RequisiteValue, combineRequirementStatuses } from "../status";
import { resultVersions } from "../versions";
import { type GroupOutcome, type Substitute, evaluateGroup } from "./group";
import { type Held, appliedCourse, holdingsOf } from "./held";
import { coursesOf, countingDomain, groupShape, openSlotsOf, spendOrder } from "./shape";

/**
 * The degree audit: one program, one record -> AuditResult. The algorithm is
 * explained in ./README.md; in short:
 *
 *   1. Read what the student holds (./held.ts).
 *   2. Walk the program's groups in spend order (./shape.ts). Each claims
 *      courses from what is still free in its counting domain (./group.ts).
 *   3. Apply record facts and advisor exceptions, check each result's numbers,
 *      and combine the statuses (../status.ts).
 */

/** How many remaining options a requirement lists before "and N more". */
export const REMAINING_SHOWN = 8;

const GRADING_POLICY: SourceReference = {
  kind: "university_policy",
  label: "UF grades and grading policies",
  url: "https://catalog.ufl.edu/UGRD/academic-regulations/grades-grading-policies/",
};

const STATUS_OF: Record<RequisiteValue, RequirementStatus> = {
  met: "satisfied",
  pending: "in_progress",
  not_met: "not_satisfied",
  unknown: "unknown",
};

/** Record facts that waive a group (`logic.waived_by` in the data). */
const WAIVER_FACTS: Record<string, { fact: keyof AcademicRecord["facts"]; what: string }> = {
  aa_or_60_credits: { fact: "hasFloridaAA", what: "a Florida AA degree" },
  language_placement_or_proficiency: { fact: "languageProficiency", what: "foreign-language proficiency" },
};

const EPSILON = 1e-9;
const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

export function auditProgram(
  catalog: Catalog,
  record: AcademicRecord,
  programId: string,
  history: CourseHistory = new CourseHistory(record, catalog),
): AuditResult {
  const program = catalog.programs[programId];
  if (!program) throw new RangeError(`unknown program id "${programId}"`);
  const holdings = holdingsOf(history);
  const programSource: SourceReference = program.source;
  const groupSource = (g: RequirementGroup): SourceReference[] => [
    { ...programSource, excerpt: typeof g.logic.heading === "string" ? g.logic.heading : g.name },
  ];
  const outcomes =
    program.status === "needs_review"
      ? new Map(program.requirements.map((g) => [g.key, needsReviewOutcome(g, holdings.byCourse)]))
      : evaluateGroups(catalog, record, program, holdings);

  const requirements = program.requirements.map((g): RequirementResult => {
    const out = outcomes.get(g.key)!;
    const applied = out.applied.map((h) => appliedCourse(catalog, record, h));
    const pending = out.pending.map((h) => appliedCourse(catalog, record, h));
    const result: RequirementResult = {
      programId: program.id,
      requirementKey: g.key,
      name: g.name,
      section: g.section,
      ruleType: g.ruleType,
      countsTowardDegree: g.section !== "options",
      status: STATUS_OF[out.value],
      reasons: out.reasons,
      required: { credits: g.requiredCredits, courses: g.requiredCourseCount },
      completed: { credits: sum(applied.map((a) => a.credits)), courses: applied.length },
      inProgress: { credits: sum(pending.map((a) => a.credits)), courses: pending.length },
      appliedCourses: applied,
      pendingCourses: pending,
      remainingOptions: {
        courseIds: out.remaining.slice(0, REMAINING_SHOWN),
        total: out.remaining.length,
        openSlots: out.openSlots,
      },
      sources: groupSource(g),
    };
    return checkNumbers(result);
  });

  const counting = requirements.filter((r) => r.countsTowardDegree);
  const overallStatus = combineRequirementStatuses(
    counting.map((r) => r.status),
    program.status === "needs_review",
  );
  const counted = new Set(counting.flatMap((r) => r.appliedCourses.map((a) => a.courseId)));
  const requiredCredits = counting.map((r) => r.required.credits);

  return AuditResult.parse({
    versions: resultVersions(catalog, record),
    programId: program.id,
    programName: program.name,
    programKind: program.kind,
    programStatus: program.status,
    overallStatus,
    reasons: overallReasons(program, counting, overallStatus),
    caveats: caveatsFor(program, record),
    totals: {
      required: { credits: requiredCredits.some((c) => c === null) ? null : sum(requiredCredits as number[]) },
      completed: { credits: sum(counting.map((r) => r.completed.credits)) },
      inProgress: { credits: sum(counting.map((r) => r.inProgress.credits)) },
    },
    requirements,
    unappliedCourses: holdings.completed
      .filter((h) => !counted.has(h.courseId))
      .map((h) => appliedCourse(catalog, record, h)),
    gpa: [ufCumulativeGpa(history)],
    sources: [programSource, GRADING_POLICY],
  });
}

// ---------------------------------------------------------------------------
// Claiming, group by group
// ---------------------------------------------------------------------------

function evaluateGroups(
  catalog: Catalog,
  record: AcademicRecord,
  program: Program,
  holdings: ReturnType<typeof holdingsOf>,
): Map<string, GroupOutcome> {
  const exceptions = record.exceptions;
  const nameOf = (key: string) => program.requirements.find((g) => g.key === key)?.name ?? key;
  const claims = new Map<string, Map<string, string>>();
  const order = spendOrder(program.requirements);
  const usable = new Map(order.map((g) => [g.key, new Set(coursesOf(groupShape(g)))]));
  const outcomes = new Map<string, GroupOutcome>();

  order.forEach((group, i) => {
    const domain = countingDomain(group);
    if (domain && !claims.has(domain)) claims.set(domain, new Map());
    const later = order.slice(i + 1).filter((g) => domain && countingDomain(g) === domain);

    // A waiver the record grants: the group is met, and claims nothing.
    const waiver = exceptions.find(
      (e) => e.kind === "waiver" && e.programId === program.id && e.requirementKey === group.key,
    );
    if (waiver) {
      outcomes.set(group.key, waived(`Waived by advisor exception ${waiver.exceptionId}: ${waiver.note}`));
      return;
    }
    const fact = group.logic.waived_by ? WAIVER_FACTS[group.logic.waived_by] : undefined;
    if (fact && record.facts[fact.fact] === true) {
      outcomes.set(group.key, waived(`Waived: the record shows ${fact.what}.`));
      return;
    }

    const substitutes: Substitute[] = exceptions.flatMap((e) => {
      if (e.kind !== "substitution" || e.programId !== program.id || e.requirementKey !== group.key) return [];
      const held = holdings.byCourse.get(e.courseId);
      return held ? [{ held: { ...held, exceptionId: e.exceptionId }, replaces: e.replacesCourseId }] : [];
    });

    const out = evaluateGroup(group, {
      catalog,
      holdings,
      claimed: domain ? claims.get(domain)! : null,
      overlapAllowed: (courseId, ownerKey) =>
        exceptions.some(
          (e) =>
            e.kind === "allow_overlap" &&
            e.courseId === courseId &&
            [group.key, ownerKey].every((k) => e.requirements.some((r) => r.programId === program.id && r.requirementKey === k)),
        ),
      contested: (id) => later.some((g) => usable.get(g.key)!.has(id)),
      substitutes,
      nameOf,
    });

    // A fact that would waive the group, absent from the record: an unmet
    // group can't be called unmet.
    if (fact && record.facts[fact.fact] === undefined && out.value === "not_met") {
      out.value = "unknown";
      out.reasons.push({
        code: "missing_input",
        message: `The record doesn't say whether the student has ${fact.what}, which would waive this requirement.`,
      });
    }
    outcomes.set(group.key, out);
  });
  return outcomes;
}

function waived(message: string): GroupOutcome {
  return { value: "met", applied: [], pending: [], reasons: [{ code: "waived", message }], remaining: [], openSlots: [] };
}

/** A program whose data needs review: nothing is claimed, because a course
 *  credited to a requirement we can't trust would read as progress. */
function needsReviewOutcome(group: RequirementGroup, held: ReadonlyMap<string, Held>): GroupOutcome {
  const shape = groupShape(group);
  const slotProse = shape.kind === "slots" ? shape.slots.flatMap((s) => s.prose) : [];
  const openSlots = slotProse.length ? slotProse : openSlotsOf(group);
  return {
    value: "unknown",
    applied: [],
    pending: [],
    reasons: [
      { code: "program_needs_review", message: "This program's data needs review; this requirement may not be read correctly." },
      // The prose rows are usually why the program needs review: name them.
      ...openSlots.map((s): Reason => ({ code: "rule_not_modeled", message: `The page prints "${s.label}" here; what it requires isn't captured.` })),
    ],
    remaining: coursesOf(shape).filter((id) => !held.has(id)),
    openSlots,
  };
}

// ---------------------------------------------------------------------------
// Checks and summaries
// ---------------------------------------------------------------------------

/** The catalog states each requirement's credits and course count. When
 *  every rule is met but the courses fall short of those numbers (a 3-credit
 *  transfer course in a 4-credit slot, a variable-credit course), whether the
 *  difference must be made up is an advisor's call: unknown, saying so. */
function checkNumbers(r: RequirementResult): RequirementResult {
  const meets = (have: { credits: number; courses: number }) =>
    (r.required.credits === null || have.credits + EPSILON >= r.required.credits) &&
    (r.required.courses === null || have.courses >= r.required.courses);
  const total = { credits: r.completed.credits + r.inProgress.credits, courses: r.completed.courses + r.inProgress.courses };
  const waivedHere = r.reasons.some((x) => x.code === "waived");
  const short =
    (r.status === "satisfied" && !waivedHere && !meets(r.completed)) || (r.status === "in_progress" && !meets(total));
  if (!short) return r;
  const have = r.status === "satisfied" ? r.completed : total;
  return {
    ...r,
    status: "unknown",
    reasons: [
      ...r.reasons,
      {
        code: "rule_not_modeled",
        message: `Every rule of this requirement is met, but the courses come to ${have.credits} credits / ${have.courses} courses against the catalog's ${r.required.credits ?? "-"} / ${r.required.courses ?? "-"}. An advisor should confirm whether the difference must be made up.`,
      },
    ],
  };
}

function overallReasons(program: Program, counting: RequirementResult[], status: RequirementStatus): Reason[] {
  if (program.status === "needs_review")
    return [
      {
        code: "program_needs_review",
        message: `The ${program.name} ${program.kind}'s requirements could not be verified from the catalog page, so no requirement can be confirmed met or unmet. An advisor should check this program by hand.`,
        sources: [program.source],
      },
    ];
  const names = (s: RequirementStatus) => counting.filter((r) => r.status === s).map((r) => r.name);
  const reasons: Reason[] = [];
  if (names("not_satisfied").length)
    reasons.push({ code: "requirements_remaining", message: `Not met even counting current courses: ${names("not_satisfied").join("; ")}.` });
  if (names("unknown").length)
    reasons.push({
      code: "rule_not_modeled",
      message: `Can't be decided from the data and record (each requirement says why): ${names("unknown").join("; ")}.`,
    });
  if (status === "in_progress")
    reasons.push({ code: "in_progress_pending", message: `Met once current courses are passed: ${names("in_progress").join("; ")}.` });
  return reasons;
}

function caveatsFor(program: Program, record: AcademicRecord): Reason[] {
  const caveats: Reason[] = [];
  if (program.status === "published")
    caveats.push({
      code: "program_rules_not_captured",
      message:
        "Rules the program page states in prose are not checked: credits that must be taken at UF, upper-division minimums, credits that can't be shared with another program, independent-study limits.",
      sources: [program.source],
    });
  caveats.push({
    code: "grade_minimums_not_checked",
    message: "Minimum grades for requirement courses are not in the program data yet, so passing grades are counted as they are.",
  });
  const aaGroups = program.requirements.filter((g) => g.logic.waived_by === "aa_or_60_credits");
  if (aaGroups.length && record.facts.hasFloridaAA !== true)
    caveats.push({
      code: "rule_not_modeled",
      message: "The gen ed waiver is recorded as \"AA or 60 credits\"; only the Florida AA part is checked.",
    });
  return caveats;
}

function ufCumulativeGpa(history: CourseHistory): GpaResult {
  const g = history.ufCumulativeGpa();
  return {
    kind: "uf_cumulative",
    status: g.value === null ? "unknown" : "computed",
    value: g.value,
    gradePoints: g.gradePoints,
    gpaHours: g.gpaHours,
    attemptIds: g.attemptIds,
    reasons: g.value === null ? [{ code: "missing_input", message: "No graded UF attempts yet." }] : [],
  };
}
