import { CourseHistory, displayCode } from "./history";
import { type MilestoneStatus, type RequisiteValue, combineAnd, combineMilestones, combineOr } from "./status";
import type { Reason, Term } from "./schemas/common";
import type { Catalog, Milestone, Program } from "./schemas/catalog";
import type { AcademicRecord, Grade } from "./schemas/record";
import { type MilestoneResult, TrackingResult } from "./schemas/results";
import { resultVersions } from "./versions";

/**
 * Critical Tracking: is the student on track for a program's semester-by-
 * semester milestones? See ./README.md (Critical Tracking) for the rules.
 *
 *   evaluateTracking(catalog, record, "uglas-psy_bs01")
 *
 * Milestones are checked against the record AS IT STANDS NOW, not as it stood
 * when each semester ended: a course finished a semester late counts as met.
 * The question answered is "is this student on track today", which is what
 * an advisor acts on. (UF reviews tracking at the end of each term.)
 *
 * Changed from UF Planner: its milestone pass checked course lists only, read
 * an incremental line ("1 tracking course" after "2 of 3") as the weaker
 * absolute count, and had no GPA or grade rules. Here GPA rows are evaluated
 * (the UF GPA) or reported as unchecked, line minimum grades apply, and a
 * milestone weaker than an earlier one is not trusted.
 */

/** Semesters are UF's enrolled fall/spring terms; summers don't count. */
export function enrolledSemesters(first: Term, current: Term): number {
  let n = 0;
  for (let year = first.year; year <= current.year; year++)
    for (const season of ["spring", "fall"] as const) {
      const t = { season, year };
      if (order(t) >= order(first) && order(t) <= order(current)) n++;
    }
  // A student who started in summer is heading into semester 1.
  return Math.max(n, 1);
}
const order = (t: Term) => t.year * 3 + { spring: 0, summer: 1, fall: 2 }[t.season];

type Slot = string[][]; // " or " alternatives, each an AND-set

export function evaluateTracking(
  catalog: Catalog,
  record: AcademicRecord,
  programId: string,
  history = new CourseHistory(record, catalog),
): TrackingResult {
  const program = catalog.programs[programId];
  if (!program) throw new RangeError(`unknown program "${programId}"`);
  if (program.milestones.length === 0)
    throw new RangeError(`${programId} publishes no Critical Tracking milestones`);
  const currentSemester = enrolledSemesters(record.firstTerm, record.currentTerm);
  const ctx: Context = { catalog, record, history, program, currentSemester };

  const milestones = program.milestones.map((m, i) => evaluateMilestone(ctx, m, program.milestones.slice(0, i)));
  const status = combineMilestones(milestones, currentSemester);
  return TrackingResult.parse({
    versions: resultVersions(catalog, record),
    programId,
    currentSemester,
    status,
    milestones,
    reasons: trackingReasons(milestones, currentSemester),
    caveats: caveatsFor(program),
    sources: [program.source],
  });
}

type Context = {
  catalog: Catalog;
  record: AcademicRecord;
  history: CourseHistory;
  program: Program;
  currentSemester: number;
};

function evaluateMilestone(ctx: Context, m: Milestone, earlier: readonly Milestone[]): MilestoneResult {
  const base = {
    semester: m.semester,
    kind: m.kind,
    rawText: m.rawText,
    minGrade: m.kind === "courses" || m.kind === "count" ? m.minGrade : null,
    gpa: null,
    satisfiedBy: [],
    pendingCourses: [],
    missing: [],
  };
  const due = m.semester <= ctx.currentSemester;
  switch (m.kind) {
    case "note":
      return {
        ...base,
        status: due ? "unknown" : "upcoming",
        required: null,
        reasons: [{ code: "rule_not_modeled", message: "Prose only; no course list to check." }],
      };
    case "gpa":
      return { ...base, ...evaluateGpa(ctx, m, due), required: null };
    case "courses":
    case "count":
      return { ...base, ...evaluateCourses(ctx, m, due, earlier) };
  }
}

// ---------------------------------------------------------------------------
// Course milestones
// ---------------------------------------------------------------------------

/** The slots a course milestone counts over. A count row with no slots names
 *  a pool UF never lists on the tracking tab ("Complete all critical-tracking
 *  courses"): it is the model plan's tracking rows up to that semester. */
function slotsOf(program: Program, m: Milestone): Slot[] {
  if (m.slots.length || m.kind !== "count") return m.slots;
  return planTrackingSlots(program, m.semester);
}

/** The model plan's critical-tracking courses scheduled by fall/spring
 *  semester `semester`, one slot per course. A lab joins its lecture
 *  ("BSC 2010" + "BSC 2010L" is one slot) and the plan's "or" choices are one
 *  slot. Rows scheduled LATER are left out: a semester-5 "all tracking
 *  courses" must not demand the semester-8 capstone the plan also flags. */
export function planTrackingSlots(program: Program, semester: number): Slot[] {
  const columns = [...new Set(program.modelPlan.filter((e) => !e.isSummer && e.semesterIndex > 0).map((e) => e.semesterIndex))].sort((a, b) => a - b);
  const fallSpringIndex = (col: number) => columns.filter((c) => c <= col).length;
  const rows = program.modelPlan
    .filter((e) => e.isCriticalTracking && e.courseId && e.semesterIndex > 0 && fallSpringIndex(e.semesterIndex) <= semester)
    .sort((a, b) => a.semesterIndex - b.semesterIndex || a.position - b.position);
  const slots: Slot[] = [];
  const choice = new Map<string, Slot>();
  for (const e of rows) {
    const id = e.courseId!;
    if (e.altGroup !== null) {
      const key = `${e.semesterIndex}:${e.altGroup}`;
      let slot = choice.get(key);
      if (!slot) {
        slot = [];
        choice.set(key, slot);
        slots.push(slot);
      }
      (slot[Math.max((e.altOption ?? 1) - 1, 0)] ??= []).push(id);
      continue;
    }
    const last = slots[slots.length - 1];
    if (last?.length === 1 && last[0].length === 1 && id === `${last[0][0]}l`) last[0].push(id);
    else if (!slots.some((s) => s.length === 1 && s[0].length === 1 && s[0][0] === id)) slots.push([[id]]);
  }
  return slots.map((s) => s.filter(Boolean));
}

/** How many slots a course milestone demands. */
const demandOf = (m: Milestone, slots: Slot[]) =>
  m.kind === "courses" || m.count === null || m.count < 0 ? slots.length : m.count;

const membersOf = (slots: Slot[]) => new Set(slots.flat(2));

/** UF states tracking cumulatively: a later milestone over the same courses
 *  never asks for fewer. One that reads weaker ("1 tracking course from" four
 *  after "2 of the following" three) was worded incrementally ("one more",
 *  "the final") and stored as an absolute count; read as stored, completed
 *  work would always meet it. Returns the earlier milestone it undercuts. */
function undercut(program: Program, m: Milestone, slots: Slot[], earlier: readonly Milestone[]): Milestone | null {
  const members = membersOf(slots);
  const demand = demandOf(m, slots);
  for (const e of earlier) {
    if (e.semester >= m.semester || (e.kind !== "courses" && e.kind !== "count")) continue;
    const eSlots = slotsOf(program, e);
    if (eSlots.length === 0 || demandOf(e, eSlots) <= demand) continue;
    if ([...membersOf(eSlots)].every((id) => members.has(id))) return e;
  }
  return null;
}

function evaluateCourses(
  ctx: Context,
  m: Milestone,
  due: boolean,
  earlier: readonly Milestone[],
): Pick<MilestoneResult, "status" | "required" | "satisfiedBy" | "pendingCourses" | "missing" | "reasons"> {
  const slots = slotsOf(ctx.program, m);
  if (slots.length === 0)
    return {
      status: due ? "unknown" : "upcoming",
      required: null,
      satisfiedBy: [],
      pendingCourses: [],
      missing: [],
      reasons: [{ code: "rule_not_modeled", message: "The page names no tracking courses for this count, and the model plan flags none by this semester." }],
    };
  // UF: "A grade of S is equal to a C (2.0) or better."
  const min: Grade | undefined = m.minGrade === "S" ? "C" : (m.minGrade ?? undefined);
  const judged = slots.map((alternatives) => {
    const options = alternatives.map((set) => {
      const each = set.map((id) => ({ id, value: ctx.history.best(id, min).value }));
      return { set, each, value: combineAnd(each.map((c) => c.value)) };
    });
    const value = combineOr(options.map((o) => o.value));
    return { alternatives, options, value, chosen: options.find((o) => o.value === value) };
  });
  const required = demandOf(m, slots);
  const tally = (v: RequisiteValue) => judged.filter((j) => j.value === v).length;
  const [met, pending, unknown] = [tally("met"), tally("pending"), tally("unknown")];
  let value: RequisiteValue =
    met >= required ? "met"
    : met + pending >= required ? "pending"
    : met + pending + unknown >= required ? "unknown"
    : "not_met";

  const code = (id: string) => displayCode(ctx.catalog, id);
  const satisfiedBy = judged.filter((j) => j.value === "met").flatMap((j) => j.chosen!.set);
  const open = judged.filter((j) => j.value !== "met");
  const pendingCourses =
    value === "met" ? [] : open.filter((j) => j.value === "pending").flatMap((j) => j.chosen!.each.filter((c) => c.value === "pending").map((c) => c.id));
  const missing = value === "met" ? [] : open.map((j) => j.alternatives.map((set) => set.map(code).join(" + ")).join(" or "));

  const reasons: Reason[] = [];
  const grade = m.minGrade ? ` with a ${m.minGrade === "S" ? "grade of S (or C or better)" : `minimum grade of ${m.minGrade}`}` : "";
  const weaker = undercut(ctx.program, m, slots, earlier);
  if (weaker && value !== "not_met") {
    // A stronger reading can't be met when the weak one isn't, so not_met
    // stands; anything better isn't trusted.
    reasons.push({
      code: "rule_not_modeled",
      message: `Semester ${weaker.semester} already asks for ${demandOf(weaker, slotsOf(ctx.program, weaker))} of these courses, and this milestone, as stored, asks for ${required}. UF likely means more in total ("one more", "the final"), so it isn't checked.`,
    });
    value = "unknown";
  } else if (value === "pending") {
    // "2 of 3" with one done and two in progress needs only one of them.
    const need = required - met;
    const pendingSlots = judged.filter((j) => j.value === "pending").length;
    const which = need < pendingSlots
      ? `${need} of ${list(pendingCourses.map(code), "or")} (in progress) ${need > 1 ? "are" : "is"}`
      : `${list(pendingCourses.map(code))} (in progress) ${pendingCourses.length > 1 ? "are" : "is"}`;
    reasons.push({ code: "in_progress_pending", message: `Met if ${which} passed${grade}.`, courseIds: pendingCourses });
  } else if (value === "unknown") {
    reasons.push({ code: "missing_grade", message: "A completed course here has no grade on record." });
  } else if (value === "not_met") {
    reasons.push({
      code: "requirements_remaining",
      message: `Needs ${required - met} more of: ${missing.join("; ")}${grade}.`,
    });
  }

  return {
    status: statusOf(value, due),
    required,
    satisfiedBy: [...new Set(satisfiedBy)],
    pendingCourses: [...new Set(pendingCourses)],
    missing,
    reasons,
  };
}

/** A milestone whose semester is still ahead and isn't met yet is upcoming:
 *  being in semester 3 with a semester-5 course untaken is normal. */
function statusOf(value: RequisiteValue, due: boolean): MilestoneStatus {
  if (value === "met") return "met";
  if (!due) return "upcoming";
  return value;
}

// ---------------------------------------------------------------------------
// GPA milestones
// ---------------------------------------------------------------------------

const SCOPE_NAME: Record<NonNullable<Milestone["gpaScope"]>, string> = {
  uf: "UF cumulative",
  critical_tracking: "critical-tracking",
  upper_division: "upper-division",
  all_institutions: "all-institution",
  other: "program-specific",
};

/** Only the UF cumulative GPA is computed. The others are GPAs over a subset
 *  whose rules differ by page ("all attempts", "best of two attempts",
 *  "excluding ECO 3101", "all work at all institutions"). */
function evaluateGpa(
  ctx: Context,
  m: Milestone,
  due: boolean,
): Pick<MilestoneResult, "status" | "gpa" | "pendingCourses" | "reasons"> {
  const scope = m.gpaScope!;
  const min = m.gpaMin!;
  const name = `${min.toFixed(2).replace(/0$/, "")} ${SCOPE_NAME[scope]} GPA`;
  if (scope !== "uf")
    return {
      status: due ? "unknown" : "upcoming",
      gpa: { scope, min, value: null },
      pendingCourses: [],
      reasons: [{ code: "gpa_rule_not_checked", message: `UF requires a ${name} here; the engine doesn't compute that GPA, so it isn't checked.` }],
    };

  const ufAttempts = ctx.record.attempts.filter((a) => a.source === "uf");
  const ungraded = ufAttempts.filter((a) => a.status === "completed" && !a.grade);
  const current = ufAttempts.filter((a) => a.status === "in_progress").map((a) => a.courseId);
  const gpa = ctx.history.ufCumulativeGpa();
  const value = gpa.value;
  const result = { gpa: { scope, min, value } };
  if (ungraded.length)
    return {
      ...result,
      status: due ? "unknown" : "upcoming",
      pendingCourses: [],
      reasons: [{ code: "missing_grade", message: `A completed UF course has no grade on record, so the UF GPA can't be computed.`, courseIds: ungraded.map((a) => a.courseId) }],
    };
  const shown = value === null ? "no UF GPA yet" : `UF GPA ${value.toFixed(2)}`;
  const meets = value !== null && value + 1e-9 >= min;
  // A GPA can still fall before a later semester: met only once it is due.
  if (meets && due) return { ...result, status: "met", pendingCourses: [], reasons: [] };
  if (meets) return { ...result, status: "upcoming", pendingCourses: [], reasons: [] };
  if (!due)
    return {
      ...result,
      status: "upcoming",
      pendingCourses: [],
      reasons: [{ code: "gpa_below_minimum", message: `Needs a ${name} by semester ${m.semester}; ${shown} today.` }],
    };
  // Due this semester with grades still to come: it rests on this term.
  if (m.semester === ctx.currentSemester && current.length)
    return {
      ...result,
      status: "pending",
      pendingCourses: [...new Set(current)],
      reasons: [{
        code: "in_progress_pending",
        message: `Needs a ${name} by the end of this semester; ${shown}, before this term's grades (${list(current.map((id) => displayCode(ctx.catalog, id)))}).`,
        courseIds: [...new Set(current)],
      }],
    };
  return {
    ...result,
    status: value === null ? "unknown" : "not_met",
    pendingCourses: [],
    reasons: [value === null
      ? { code: "missing_input", message: "No graded UF courses on record, so there is no UF GPA to check." }
      : { code: "gpa_below_minimum", message: `Needs a ${name}; ${shown}.` }],
  };
}

// ---------------------------------------------------------------------------
// Program-level reasons and caveats
// ---------------------------------------------------------------------------

/** Why the program's status is what it is: every due milestone that isn't
 *  met, in semester order, its first reason prefixed with the semester. */
function trackingReasons(milestones: readonly MilestoneResult[], currentSemester: number): Reason[] {
  return milestones
    .filter((m) => m.semester <= currentSemester && m.status !== "met" && m.reasons.length)
    .map((m) => ({ ...m.reasons[0], message: `Semester ${m.semester}: ${m.reasons[0].message}` }));
}

function caveatsFor(program: Program): Reason[] {
  const caveats: Reason[] = [
    {
      code: "rule_not_modeled",
      message: "Semesters are counted as fall and spring terms from the first UF term to now, assuming continuous enrollment; milestones are checked against the record today, so a course finished late counts.",
    },
  ];
  const unchecked = program.milestones.filter((m) => m.kind === "gpa" && m.gpaScope !== "uf");
  if (unchecked.length)
    caveats.push({
      code: "gpa_rule_not_checked",
      message: `Only the UF cumulative GPA is computed. Thresholds for the ${list([...new Set(unchecked.map((m) => SCOPE_NAME[m.gpaScope!]))])} GPA are listed but not checked; which courses and attempts count differs by program.`,
    });
  const course = program.milestones.filter((m) => m.kind === "courses" || m.kind === "count");
  if (course.some((m) => m.minGrade === null && /grade/i.test(m.rawText)))
    caveats.push({
      code: "grade_minimums_not_checked",
      message: "A minimum grade the page gives for a single course within a line isn't checked; a line's grade for all its courses is.",
    });
  if (program.milestones.some((m) => /\battempts?\b/i.test(m.rawText)))
    caveats.push({ code: "rule_not_modeled", message: "Attempt limits (\"within two attempts\") aren't checked." });
  return caveats;
}

const list = (items: string[], joiner = "and") =>
  items.length <= 2 ? items.join(` ${joiner} `) : `${items.slice(0, -1).join(", ")} ${joiner} ${items[items.length - 1]}`;
