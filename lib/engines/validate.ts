import { auditProgram } from "./audit";
import { missedMessage, trackingDeadlines } from "./deadlines";
import { evaluateEligibility } from "./eligibility";
import { CourseHistory, displayCode } from "./history";
import { ASSUMED_TERM_LOAD, type PlannedEntry, recordAfter, recordAtStartOf } from "./hypothetical";
import { offeringOf } from "./offering";
import { type Term, compareTerms, parseCourseId } from "./schemas/common";
import type { Catalog } from "./schemas/catalog";
import { type Plan, PlanCheck, PlanDraft, type PlanIssue } from "./schemas/plan";
import type { AcademicRecord } from "./schemas/record";
import { declaredPrograms } from "./student";
import { resultVersions } from "./versions";

/**
 * Plan validation: can this plan work, as written? Checks any plan, whether
 * the planner made it or a student or advisor did, with the same engines
 * a registration would use:
 *
 *   terms        after the record's current term, in order, no repeats
 *   courses      real course codes, each planned once; a course already
 *                passed or in progress is flagged
 *   credits      at most `creditCap` per term (when a cap is given)
 *   requisites   evaluateEligibility at each term, on the record as it
 *                would stand then (earlier planned courses assumed passed;
 *                same-term courses count for corequisites)
 *   offerings    not in a term's complete published schedule = error; not
 *                seen in that season before = warning
 *   tracking     every open Critical Tracking milestone covered by its term
 *   requirements what each program still lacks once the whole plan passes
 */

const creditsOf = (catalog: Catalog, id: string) => catalog.courses[id]?.creditsMin ?? 3;

/** A generated Plan as a draft (placeholders, which name no course, are left out). */
export function draftOf(plan: Plan): PlanDraft {
  return {
    terms: plan.terms.map((t) => ({ term: t.term, courses: t.courses.flatMap((c) => (c.courseId ? [c.courseId] : [])) })),
    programIds: plan.programIds,
  };
}

export function validatePlan(catalog: Catalog, record: AcademicRecord, draftInput: PlanDraft): PlanCheck {
  const draft = PlanDraft.parse(draftInput);
  const issues: PlanIssue[] = [];
  const add = (i: PlanIssue) => issues.push(i);
  const programIds = draft.programIds ?? declaredPrograms(catalog, record);
  const history = new CourseHistory(record, catalog);

  // Terms.
  const terms = draft.terms;
  terms.forEach((t, i) => {
    if (compareTerms(t.term, record.currentTerm) <= 0)
      add({ severity: "error", code: "term_out_of_range", message: `${termName(t.term)} isn't after the record's current term.`, term: t.term });
    if (i > 0 && compareTerms(terms[i - 1].term, t.term) >= 0)
      add({ severity: "error", code: "term_out_of_range", message: `${termName(t.term)} is out of order or repeated.`, term: t.term });
  });

  // Courses: codes, duplicates, already held.
  const planned: PlannedEntry[] = [];
  const seen = new Map<string, Term>();
  for (const t of terms)
    for (const raw of t.courses) {
      const id = parseCourseId(raw);
      if (!id || !catalog.courses[id]) {
        add({ severity: "error", code: "unknown_course", message: `"${raw}" isn't a course in the catalog or the Schedule of Courses.`, term: t.term });
        continue;
      }
      const code = displayCode(catalog, id);
      if (seen.has(id)) {
        add({ severity: "error", code: "duplicate_course", message: `${code} is planned in both ${termName(seen.get(id)!)} and ${termName(t.term)}.`, term: t.term, courseIds: [id] });
        continue;
      }
      seen.set(id, t.term);
      const taken = history.taken(id).status;
      if (taken === "passed" || taken === "in_progress")
        add({ severity: "warning", code: "already_held", message: `${code} is already ${taken === "passed" ? "passed" : "in progress"}; planning it again is a repeat.`, term: t.term, courseIds: [id] });
      planned.push({ courseId: id, term: t.term, credits: creditsOf(catalog, id) });
    }

  // Credits per term.
  if (draft.creditCap !== undefined)
    for (const t of terms) {
      const credits = planned.filter((p) => compareTerms(p.term, t.term) === 0).reduce((s, p) => s + p.credits, 0);
      if (credits > draft.creditCap + 1e-9)
        add({ severity: "error", code: "credit_cap", message: `${termName(t.term)} has ${credits} credits, over the ${draft.creditCap}-credit cap.`, term: t.term });
    }

  // Requisites and offerings, term by term. Standing counts each planned
  // fall/spring term as at least the assumed load (default 12 credits).
  const load = { terms: terms.map((t) => t.term), credits: draft.assumedTermLoad ?? ASSUMED_TERM_LOAD };
  const valid = terms.filter((t) => compareTerms(t.term, record.currentTerm) > 0);
  for (const t of valid) {
    const here = planned.filter((p) => compareTerms(p.term, t.term) === 0);
    if (!here.length) continue;
    const before = planned.filter((p) => compareTerms(p.term, t.term) < 0);
    const rec = recordAtStartOf(record, before, t.term, load);
    const h = rec === record ? history : new CourseHistory(rec, catalog);
    for (const p of here) {
      const code = displayCode(catalog, p.courseId);
      const e = evaluateEligibility(catalog, rec, p.courseId, t.term, { concurrent: here.map((x) => x.courseId).filter((x) => x !== p.courseId) }, h);
      if (e.status === "not_eligible")
        add({ severity: "error", code: "prerequisite_chain", message: `${code} in ${termName(t.term)}: ${e.reasons.map((r) => r.message).join(" ")}`, term: t.term, courseIds: [p.courseId] });
      else if (e.status === "unknown")
        add({ severity: "warning", code: e.reasons[0]?.code ?? "requisite_unverifiable", message: `${code} in ${termName(t.term)}: ${e.reasons.map((r) => r.message).join(" ")}`, term: t.term, courseIds: [p.courseId] });
      const o = offeringOf(catalog, p.courseId, t.term);
      const neverOffered = !(catalog.schedule.offeredTerms[p.courseId]?.length);
      if (o.status === "not_scheduled")
        add({ severity: "error", code: "not_offered", message: `${code}: ${o.message}`, term: t.term, courseIds: [p.courseId] });
      else if (o.status === "not_seen" || o.status === "unknown" || neverOffered)
        add({ severity: "warning", code: "offering_unconfirmed", message: `${code}: ${neverOffered ? "no sections in any term read (Fall 2021 on)" : o.message}`, term: t.term, courseIds: [p.courseId] });
    }
  }

  // Critical Tracking deadlines.
  const placedBy = (id: string, due: Term) => {
    const t = seen.get(id);
    return t !== undefined && compareTerms(t, due) <= 0;
  };
  for (const pid of programIds)
    for (const d of trackingDeadlines(catalog, record, pid, history)) {
      if (d.missed) {
        add({ severity: "error", code: "deadline_unreachable", message: missedMessage(catalog, d) });
        continue;
      }
      const met = d.open.filter((slot) => slot.some((set) => set.every((id) => placedBy(id, d.dueTerm)))).length;
      if (met < d.needed)
        add({
          severity: "error",
          code: "deadline_unreachable",
          message: `${catalog.programs[pid].name}: semester ${d.semester} tracking needs ${d.needed - met} more by ${termName(d.dueTerm)}: "${d.rawText}".`,
          term: d.dueTerm,
        });
    }

  // Requirements once the whole plan is passed.
  const last = valid.at(-1)?.term ?? record.currentTerm;
  const after = recordAfter(record, planned, last, load);
  const afterHistory = new CourseHistory(after, catalog);
  const programsAfter = programIds.map((pid) => {
    const a = auditProgram(catalog, after, pid, afterHistory);
    const open = a.requirements
      .filter((r) => r.countsTowardDegree && (r.status === "not_satisfied" || r.status === "unknown"))
      .map((r) => ({ requirementKey: r.requirementKey, name: r.name, status: r.status as "not_satisfied" | "unknown", reasons: r.reasons }));
    for (const r of open)
      add({
        severity: r.status === "not_satisfied" ? "error" : "warning",
        code: r.status === "not_satisfied" ? "requirements_remaining" : (r.reasons[0]?.code ?? "rule_not_modeled"),
        message: `${a.programName}: "${r.name}" ${r.status === "not_satisfied" ? "is still not met after this plan" : "can't be confirmed after this plan"}${r.reasons[0] ? ` (${r.reasons[0].message})` : ""}.`,
      });
    return {
      programId: pid,
      overallStatus: a.overallStatus,
      remainingCredits: a.totals.remaining.credits,
      open: open.map(({ requirementKey, name, status }) => ({ requirementKey, name, status })),
    };
  });

  return PlanCheck.parse({
    versions: resultVersions(catalog, record),
    valid: !issues.some((i) => i.severity === "error"),
    issues,
    programsAfter,
  });
}

export const termName = (t: Term) => `${t.season[0].toUpperCase()}${t.season.slice(1)} ${t.year}`;
