import { CourseHistory, courseLevel, displayCode } from "./history";
import { type ReasonCode, type Reason, type SourceReference, type Term, compareTerms } from "./schemas/common";
import type { Catalog, Requisite, RequisiteNode } from "./schemas/catalog";
import type { AcademicRecord } from "./schemas/record";
import { EligibilityResult, type RequisiteEvaluation } from "./schemas/results";
import { ELIGIBILITY_OF, type RequisiteValue, combineAnd, combineOr } from "./status";
import { offeringOf } from "./offering";
import { resultVersions } from "./versions";

/**
 * Course eligibility: evaluates a course's prerequisite and corequisite trees
 * against a record, with four values (see status.ts). The rule of thumb is
 * that a leaf is `not_met` only when the record PROVES it unmet; anything the
 * engine can't decide is `unknown`, and unknown is never reported as
 * eligible.
 *
 * Changed from UF Planner: its prereqsSatisfied flattened requisites into
 * course rows and passed anything it couldn't read; this walks the parsed
 * tree and keeps what it can't decide visible.
 */

export type EligibilityOptions = {
  /** Courses the student would take in the same term. They satisfy a
   *  COREQUISITE as pending (that is what a corequisite allows); they never
   *  satisfy a prerequisite. */
  concurrent?: readonly string[];
};

/** A judged node: the public evaluation plus, for an undecided leaf, the
 *  reason code that explains it. */
type Judged = {
  ev: RequisiteEvaluation;
  why?: ReasonCode;
  courseIds?: string[];
  kids?: Judged[];
};

type Ctx = {
  catalog: Catalog;
  record: AcademicRecord;
  history: CourseHistory;
  /** Concurrent courses, only while evaluating a corequisite. */
  concurrent: ReadonlySet<string>;
  /** The course being evaluated. */
  self: string;
};

/** Earned credits each class starts at (UF catalog, Student Classifications:
 *  "Students who have earned 60 credits and have fewer than 90 credits" is a
 *  junior). https://catalog.ufl.edu/UGRD/academic-regulations/student-classifications/ */
const STANDING_CREDITS: Record<string, number> = { freshman: 0, sophomore: 30, junior: 60, senior: 90 };

const leaf = (
  type: string,
  value: RequisiteValue,
  label: string,
  extra: Partial<Omit<Judged, "ev">> & { evidenceIds?: string[] } = {},
): Judged => {
  const { evidenceIds, ...rest } = extra;
  return { ev: { type, value, label, ...(evidenceIds?.length ? { evidenceIds } : {}) }, ...rest };
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "ugpbh-hes_bhs02" -> "hes_bhs": the program part of an id, without the
 *  track number or the UF Online suffix, which is how requisites name
 *  programs ("HES_BHS"). */
const programBase = (programId: string) =>
  programId.slice(programId.indexOf("-") + 1).replace(/_ufo$/, "").replace(/\d+$/, "");

function judge(node: RequisiteNode, ctx: Ctx): Judged {
  switch (node.type) {
    case "and":
    case "or": {
      const kids = node.items.map((n) => judge(n, ctx));
      const values = kids.map((k) => k.ev.value);
      const label = kids
        .map((k) => (k.kids ? `(${k.ev.label})` : k.ev.label))
        .join(node.type === "and" ? " and " : " or ");
      return {
        ev: {
          type: node.type,
          value: node.type === "and" ? combineAnd(values) : combineOr(values),
          label,
          children: kids.map((k) => k.ev),
        },
        kids,
      };
    }

    case "course": {
      const id = node.course_id;
      let label = displayCode(ctx.catalog, id);
      // A course can't require itself: the catalog text is in error (CHM
      // 2045L's corequisite reads "CHM2045L"), so the leaf is unknown.
      if (id === ctx.self)
        return leaf("course", "unknown", `${label} (the course names itself; a catalog text error)`, { why: "requisite_unverifiable" });
      if (node.min_grade) label += ` (min ${node.min_grade}${node.or_s ? " or S" : ""})`;
      const { value, holdings } = ctx.history.best(id, node.min_grade, node.or_s);
      const evidenceIds = holdings.map((h) => h.entryId);
      if (value === "pending") return leaf("course", value, `${label} (in progress)`, { evidenceIds, courseIds: [id] });
      if (value === "unknown")
        return leaf("course", value, `${label} (completed, no grade recorded)`, { evidenceIds, why: "missing_grade", courseIds: [id] });
      if (value === "not_met" && ctx.concurrent.has(id))
        return leaf("course", "pending", `${label} (taken concurrently)`, { courseIds: [id] });
      return leaf("course", value, label, { evidenceIds, courseIds: [id] });
    }

    case "credits": {
      const scope = [
        node.prefixes?.map((p) => p.toUpperCase()).join("/"),
        node.from && `from ${node.from.map((c) => displayCode(ctx.catalog, c)).join(", ")}`,
        node.min_level && `at the ${node.min_level} level or above`,
        node.subject,
      ].filter(Boolean);
      const label = `${node.min} credits${scope.length ? ` of ${scope.join(" ")}` : ""}`;
      // "credits of history" names a subject, not prefixes; mapping a subject
      // to prefixes is a judgment the data doesn't make.
      if (node.subject) return leaf("credits", "unknown", label, { why: "requisite_unverifiable" });
      const filtered = Boolean(node.prefixes || node.from || node.min_level);
      const counts = (courseId: string) =>
        (!node.prefixes || node.prefixes.includes(courseId.slice(0, 3))) &&
        (!node.from || node.from.includes(courseId)) &&
        (!node.min_level || courseLevel(courseId) >= node.min_level);
      const earned = ctx.history.earnedByCourse();
      const done = earned.completed.filter((h) => counts(h.courseId));
      const now = earned.pending.filter((h) => counts(h.courseId));
      const sum = (hs: { credits: number }[]) => hs.reduce((s, h) => s + h.credits, 0);
      // Elective credit is hours without a course: it counts only toward an
      // unfiltered "N credits".
      const completed = sum(done) + (filtered ? 0 : ctx.history.electiveCredits());
      const total = completed + sum(now);
      const value: RequisiteValue = completed >= node.min ? "met" : total >= node.min ? "pending" : "not_met";
      const used = value === "met" ? done : [...done, ...now];
      return leaf("credits", value, `${label} (${completed} completed${now.length ? `, ${sum(now)} in progress` : ""})`, {
        evidenceIds: used.map((h) => h.entryId),
        courseIds: value === "pending" ? now.map((h) => h.courseId) : undefined,
      });
    }

    case "standing": {
      // UF classifies by credits EARNED (catalog, Student Classifications,
      // read 2026-11-03): sophomore 30, junior 60, senior 90. Earned hours are
      // every course's credit once (transfer included, which UF accepts "as
      // hours earned"; exam credit too, an assumption the page doesn't
      // state) plus elective credit. "Junior standing" is read as junior or
      // higher, the catalog convention; no leaf in the data sets a ceiling.
      const need = STANDING_CREDITS[node.level];
      if (need === undefined)
        return leaf("standing", "unknown", `${capitalize(node.level)} standing`, { why: "rule_not_modeled" });
      const earned = ctx.history.earnedByCourse();
      const sum = (hs: { credits: number }[]) => hs.reduce((s, h) => s + h.credits, 0);
      const completed = sum(earned.completed) + ctx.history.electiveCredits();
      const total = completed + sum(earned.pending);
      // A completed attempt with no grade may or may not have earned credit.
      const counted = new Set([...earned.completed, ...earned.pending].map((h) => h.courseId));
      const ungraded = ctx.record.attempts.filter((a) => a.status === "completed" && !a.grade && !counted.has(a.courseId));
      const value: RequisiteValue =
        completed >= need ? "met"
        : total >= need ? "pending"
        : total + sum(ungraded) >= need ? "unknown"
        : "not_met";
      const label = `${capitalize(node.level)} standing (${need}+ earned credits; ${completed} earned${total > completed ? `, ${total - completed} in progress` : ""})`;
      return leaf("standing", value, label, {
        evidenceIds: value === "met" ? undefined : ungraded.map((a) => a.attemptId),
        why: value === "unknown" ? "missing_grade" : undefined,
        courseIds: value === "pending" ? earned.pending.map((h) => h.courseId) : undefined,
      });
    }

    case "program": {
      const declared = ctx.record.programs.map((p) => ctx.catalog.programs[p.programId]).filter(Boolean);
      if (node.code) {
        const code = node.code.toLowerCase();
        const label = `Enrolled in ${node.code}`;
        // A code no catalog program carries can't be compared with the
        // record (graduate programs, renamed codes): unknown, not "not met".
        if (!Object.keys(ctx.catalog.programs).some((id) => programBase(id) === code))
          return leaf("program", "unknown", label, { why: "requisite_unverifiable" });
        return leaf("program", declared.some((p) => programBase(p.id) === code) ? "met" : "not_met", label);
      }
      // Names come from prose ("Music majors", "behavior majors") and are
      // often fragments, so only an exact match proves anything.
      const name = node.name!.toLowerCase();
      const label = `Enrolled in ${node.name}${node.kind ? ` (${node.kind})` : ""}`;
      const hit = declared.some((p) => p.name.toLowerCase() === name && (!node.kind || p.kind === node.kind));
      return hit ? leaf("program", "met", label) : leaf("program", "unknown", label, { why: "requisite_unverifiable" });
    }

    case "gpa": {
      const label = `${node.scope ? `${capitalize(node.scope)} GPA` : "GPA"} of at least ${node.min}`;
      if (node.scope) return leaf("gpa", "unknown", label, { why: "requisite_unverifiable" });
      const gpa = ctx.history.ufCumulativeGpa();
      if (gpa.value === null) return leaf("gpa", "unknown", `${label} (no UF GPA yet)`, { why: "missing_input" });
      return leaf("gpa", gpa.value >= node.min ? "met" : "not_met", `${label} (UF GPA ${gpa.value.toFixed(2)})`, {
        evidenceIds: gpa.attemptIds,
      });
    }

    case "permission":
      return leaf("permission", "unknown", node.text ?? `Permission of ${node.who ?? "the department"}`, {
        why: "requisite_unverifiable",
      });
    case "placement":
      return leaf("placement", "unknown", node.text, { why: "requisite_unverifiable" });
    case "equivalent":
      return leaf("equivalent", "unknown", "or equivalent (an advisor's judgment)", { why: "requisite_unverifiable" });
    case "unparsed":
      return leaf("unparsed", "unknown", node.text, { why: "requisite_unparsed" });
  }
}

/** The leaves that decide a node's value: in an AND or OR, the children
 *  that share the node's value (the others didn't change the answer). */
function decisive(j: Judged): Judged[] {
  if (!j.kids) return [j];
  return j.kids.filter((k) => k.ev.value === j.ev.value).flatMap(decisive);
}

const UNKNOWN_MESSAGE: Partial<Record<ReasonCode, string>> = {
  requisite_unparsed: "isn't parsed into a rule yet, so it isn't evaluated. Never read this as eligible",
  requisite_unverifiable: "needs a judgment or a fact the record doesn't have",
  rule_not_modeled: "isn't modeled by the engine yet",
  missing_grade: "has a completed attempt with no grade recorded",
  missing_input: "needs a fact the record doesn't have yet",
};

function reasonsFor(tree: Judged, which: "Prerequisite" | "Corequisite"): Reason[] {
  const value = tree.ev.value;
  if (value === "met") return [];
  const leaves = decisive(tree);
  const labels = (ls: Judged[]) => ls.map((l) => l.ev.label).join("; ");
  const courseIds = (ls: Judged[]) => {
    const ids = [...new Set(ls.flatMap((l) => l.courseIds ?? []))];
    return ids.length ? { courseIds: ids } : {};
  };
  if (value === "pending")
    return [{ code: "in_progress_pending", message: `${which} met once current courses are passed: ${labels(leaves)}.`, ...courseIds(leaves) }];
  if (value === "not_met")
    return [{ code: "requisite_not_met", message: `${which} not met: ${labels(leaves)}.`, ...courseIds(leaves) }];
  const byCode = new Map<ReasonCode, Judged[]>();
  for (const l of leaves) byCode.set(l.why!, [...(byCode.get(l.why!) ?? []), l]);
  return [...byCode].map(([code, ls]) => ({
    code,
    message: `${which} "${labels(ls)}" ${UNKNOWN_MESSAGE[code]}.`,
    ...courseIds(ls),
  }));
}

function judgeRequisite(req: Requisite | null, ctx: Ctx): Judged | null {
  if (!req) return null;
  // A requisite whose tree is missing is all prose: an unparsed leaf.
  return judge(req.tree ?? { type: "unparsed", text: req.rawText }, ctx);
}

/** Can the student take `courseId` in `term`? `term` must be after the
 *  record's current term: courses in progress then count as pending. The
 *  status is about requisites; `taken` and `offering` are reported beside it. */
export function evaluateEligibility(
  catalog: Catalog,
  record: AcademicRecord,
  courseId: string,
  term: Term,
  options: EligibilityOptions = {},
  history: CourseHistory = new CourseHistory(record, catalog),
): EligibilityResult {
  const course = catalog.courses[courseId];
  if (!course) throw new RangeError(`unknown course id "${courseId}"`);
  if (compareTerms(term, record.currentTerm) <= 0)
    throw new RangeError("eligibility is evaluated for a term after the record's currentTerm");

  const base: Omit<Ctx, "concurrent"> = { catalog, record, history, self: courseId };
  const pre = judgeRequisite(course.prerequisite, { ...base, concurrent: new Set() });
  const co = judgeRequisite(course.corequisite, { ...base, concurrent: new Set(options.concurrent) });
  const status = ELIGIBILITY_OF[combineAnd([pre?.ev.value ?? "met", co?.ev.value ?? "met"])];

  // Reasons come from the tree(s) that decided the status.
  const reasons = [
    ...(pre && ELIGIBILITY_OF[pre.ev.value] === status ? reasonsFor(pre, "Prerequisite") : []),
    ...(co && ELIGIBILITY_OF[co.ev.value] === status ? reasonsFor(co, "Corequisite") : []),
  ];
  const sources: SourceReference[] = [course.prerequisite, course.corequisite]
    .filter((r): r is Requisite => r !== null)
    .map((r) => ({ ...course.source, excerpt: r.rawText }));

  return EligibilityResult.parse({
    versions: resultVersions(catalog, record),
    courseId,
    term,
    status,
    prerequisite: pre?.ev ?? null,
    corequisite: co?.ev ?? null,
    taken: history.taken(courseId),
    offering: offeringOf(catalog, courseId, term),
    reasons,
    sources: sources.length ? sources : [course.source],
  });
}
