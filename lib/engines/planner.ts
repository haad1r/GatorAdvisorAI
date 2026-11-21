import { auditProgramDetailed } from "./audit";
import type { CountRule, Need } from "./audit/group";
import { countingDomain, groupShape, isBroadPool } from "./audit/shape";
import { type Deadline, missedMessage, trackingDeadlines } from "./deadlines";
import { evaluateEligibility } from "./eligibility";
import { CourseHistory, courseLevel, displayCode } from "./history";
import { ASSUMED_TERM_LOAD, type PlannedEntry, nextTerm, recordAfter, recordAtStartOf } from "./hypothetical";
import { offeringOf } from "./offering";
import {
  type Reason,
  type Term,
  compareTerms,
  nextRegularTerm,
  termCode,
  toCourseId,
} from "./schemas/common";
import type { Catalog, RequirementGroup, RequisiteNode } from "./schemas/catalog";
import {
  Plan,
  type PlannedCourse,
  PlanOptions,
  type PlanTerm,
  type RequirementSlot,
} from "./schemas/plan";
import type { AcademicRecord } from "./schemas/record";
import { declaredPrograms } from "./student";
import { termName, validatePlan } from "./validate";
import { resultVersions } from "./versions";

/**
 * The semester planner: record + options -> Plan. Deterministic (same
 * inputs, same plan) and greedy, in five steps:
 *
 *   1. SLOTS. Audit each program; turn what each open requirement still
 *      needs (the audit's `need`) into RequirementSlots.
 *   2. CHOOSE a course for each slot. Locks first; then fixed courses,
 *      choices (fewest options first), credit pools (broad pools last). A
 *      course counts toward one slot per program and counting domain, as
 *      in the audit, but may serve slots in different domains or programs
 *      (a major course that is also gen ed). Candidates are ranked: shared
 *      with another slot, in the caller's `prefer` list (the
 *      recommendation ranking), listed by the most open slots, fewest
 *      prerequisite credits to add, in the program's model plan, offered
 *      before, lower level, id.
 *   3. CLOSE over prerequisites (add the courses a chosen course needs) and
 *      Critical Tracking (add or date the courses milestones need).
 *   4. SCHEDULE term by term: locked courses first; then every course whose
 *      requisites are met on the record as it would stand then (earlier
 *      planned courses assumed passed), that is offered (or was offered that
 *      season before), and that fits the credit cap, earliest deadline first.
 *   5. CHECK the result with validatePlan; every error it finds is a
 *      blocker, so a plan can't be called feasible while the validator
 *      disagrees.
 *
 * Changed from UF Planner: its generatePlan followed the model plan grid
 * and checked prerequisites with the flat prereqsSatisfied (unknown passed
 * silently); this plans from the audit's remaining needs and asks the
 * eligibility engine about every placement.
 */

export const DEFAULT_CREDIT_CAP = 15;
const ASSUMED_CREDITS = 3;
const MAX_PREREQ_DEPTH = 5;
/** UF classification by earned credits (as in eligibility.ts). */
const STANDING_CREDITS: Record<string, number> = { freshman: 0, sophomore: 30, junior: 60, senior: 90 };

type Slot = RequirementSlot & { domain: string; broad: boolean; sequence: boolean; rules: CountRule[]; counted: { courseId: string; credits: number }[] };

type Chosen = {
  courseId: string;
  why: PlannedCourse["why"];
  slotIds: string[];
  locked: Term | null;
  deadline: Term | null;
  notes: Reason[];
};

export function generatePlan(
  catalog: Catalog,
  record: AcademicRecord,
  input: PlanOptions,
  basis: Plan["basis"] = "record",
): Plan {
  const options = PlanOptions.parse(input);
  const start = options.startTerm ?? nextRegularTerm(record.currentTerm);
  const target = options.targetTerm;
  if (compareTerms(start, record.currentTerm) <= 0) throw new RangeError("startTerm must be after the record's currentTerm");
  if (compareTerms(target, start) < 0) throw new RangeError("targetTerm is before startTerm");
  const programIds = options.programIds ?? declaredPrograms(catalog, record);
  for (const id of programIds) if (!catalog.programs[id]) throw new RangeError(`unknown program "${id}"`);

  const history = new CourseHistory(record, catalog);
  const held = new Set<string>();
  for (const id of new Set([...record.attempts.map((a) => a.courseId), ...record.examCredits.flatMap((e) => e.courseIds)])) {
    const s = history.taken(id).status;
    if (s === "passed" || s === "in_progress") held.add(id);
  }
  const blockers: Reason[] = [];
  const assumptions: Reason[] = [];
  const credits = (id: string) => catalog.courses[id]?.creditsMin ?? ASSUMED_CREDITS;

  // 1. Slots -------------------------------------------------------------
  const slots: Slot[] = [];
  for (const pid of programIds) {
    const program = catalog.programs[pid];
    const { result, needs } = auditProgramDetailed(catalog, record, pid, history);
    if (program.status === "needs_review")
      assumptions.push({ code: "program_needs_review", message: `${program.name}: the program's data needs review, so its slots come from unverified requirement tables. An advisor should check them.` });
    for (const r of result.requirements) {
      if (!r.countsTowardDegree || r.status === "satisfied" || r.status === "in_progress") continue;
      const group = program.requirements.find((g) => g.key === r.requirementKey)!;
      const need = needs.get(r.requirementKey) ?? null;
      if (!need) {
        assumptions.push({ code: "rule_not_modeled", message: `${program.name}: "${r.name}" can't be planned: ${r.reasons[0]?.message ?? "the data doesn't say what it needs."}` });
        continue;
      }
      if (r.reasons.some((x) => x.code === "missing_input"))
        assumptions.push({ code: "missing_input", message: `${program.name}: "${r.name}" is planned because the record doesn't say whether it is waived (${r.reasons.find((x) => x.code === "missing_input")!.message})` });
      // A course listed in two rows of one requirement is two slots; ids stay unique.
      for (const s of slotsFor(catalog, program.id, group, need, r.name)) {
        let id = s.slotId;
        for (let n = 2; slots.some((x) => x.slotId === id); n++) id = `${s.slotId}-${n}`;
        slots.push({ ...s, slotId: id });
      }
    }
  }

  // 2. Choose ------------------------------------------------------------
  const chosen = new Map<string, Chosen>();
  const usedIn = new Map<string, Set<string>>(); // courseId -> domains it fills
  const filled = new Map<string, string[]>(); // slotId -> courses
  const modelPlan = new Set(programIds.flatMap((pid) => catalog.programs[pid].modelPlan.map((e) => e.courseId).filter((x): x is string => !!x)));
  const prereqMemo = new Map<string, PrereqNeed>();
  const prereqOf = (id: string) => {
    let m = prereqMemo.get(id);
    if (!m) prereqMemo.set(id, (m = missingPrereqs(catalog, id, held, 0, new Set())));
    return m;
  };
  const banned = new Set<string>();

  const domainKey = (s: Slot) => `${s.programId}|${s.domain}`;
  const canUse = (s: Slot, id: string) => !held.has(id) && !banned.has(id) && !usedIn.get(id)?.has(domainKey(s));
  const assign = (s: Slot, id: string, why: Chosen["why"] = "requirement") => {
    const c = chosen.get(id) ?? { courseId: id, why, slotIds: [], locked: null, deadline: null, notes: [] };
    if (c.why !== "locked") c.why = "requirement";
    c.slotIds.push(s.slotId);
    chosen.set(id, c);
    if (!usedIn.has(id)) usedIn.set(id, new Set());
    usedIn.get(id)!.add(domainKey(s));
    filled.set(s.slotId, [...(filled.get(s.slotId) ?? []), id]);
  };
  // How many open slots list each course: one that fills several (a course
  // with two gen ed designations, a major course that is also gen ed) saves
  // credits.
  const listedIn = new Map<string, number>();
  for (const s of slots) for (const id of new Set(s.courseIds)) listedIn.set(id, (listedIn.get(id) ?? 0) + 1);
  const preferred = new Map((options.prefer ?? []).map((c, i) => [toCourseId(c), i]));
  const rank = (s: Slot, id: string): (number | string)[] => {
    const p = prereqOf(id);
    return [
      p.impossible ? 1 : 0,
      chosen.has(id) ? 0 : 1,
      preferred.get(id) ?? Number.MAX_SAFE_INTEGER,
      -(listedIn.get(id) ?? 0),
      p.courses.reduce((n, c) => n + credits(c), 0),
      p.unknown ? 1 : 0,
      modelPlan.has(id) ? 0 : 1,
      catalog.schedule.offeredTerms[id]?.length ? 0 : 1,
      courseLevel(id),
      id,
    ];
  };
  const best = (s: Slot, ids: readonly string[]) => [...ids].filter((id) => canUse(s, id) && catalog.courses[id]).sort((a, b) => cmp(rank(s, a), rank(s, b)))[0];

  // Locks fill the most specific slot they fit, then stand on their own.
  const locks = (options.locks ?? []).map((l) => ({ courseId: toCourseId(l.course), term: l.term }));
  for (const l of locks) {
    if (!catalog.courses[l.courseId]) {
      blockers.push({ code: "locked_conflict", message: `Locked ${l.courseId} isn't a catalog course.`, courseIds: [l.courseId] });
      continue;
    }
    const fits = slotOrder(slots).filter((s) => s.courseIds.includes(l.courseId) && canUse(s, l.courseId) && !slotFull(s, filled, credits));
    const seenDomains = new Set<string>();
    for (const s of fits) if (!seenDomains.has(domainKey(s))) { seenDomains.add(domainKey(s)); assign(s, l.courseId); }
    const c = chosen.get(l.courseId) ?? { courseId: l.courseId, why: "locked" as const, slotIds: [], locked: null, deadline: null, notes: [] };
    c.why = "locked";
    c.locked = l.term;
    chosen.set(l.courseId, c);
  }

  const choose = () => {
    for (const s of slotOrder(slots)) {
      if (slotFull(s, filled, credits)) continue;
      if (s.kind === "course" || s.kind === "choice") {
        const id = best(s, s.courseIds);
        if (id) assign(s, id);
        // The same required course listed in two requirements of a program
        // (the audit's listed_twice): one planned course fills both.
        else if (s.kind === "course" && chosen.has(s.courseIds[0]) && !banned.has(s.courseIds[0])) assign(s, s.courseIds[0]);
        continue;
      }
      if (s.courseIds.length === 0) continue; // prose: a placeholder later
      // A credit pool: floors first ("at least one 4000-level course"), then credits.
      const tallyOf = (r: CountRule) =>
        [...s.counted, ...(filled.get(s.slotId) ?? []).map((id) => ({ courseId: id, credits: credits(id) }))]
          .filter((x) => countsToward(r, x.courseId))
          .reduce((n, x) => n + (r.unit === "credits" ? x.credits : 1), 0);
      const breaksCeiling = (id: string) => s.rules.some((r) => r.at_most !== undefined && countsToward(r, id) && tallyOf(r) + (r.unit === "credits" ? credits(id) : 1) > r.at_most);
      for (const r of s.rules) {
        while (r.at_least !== undefined && tallyOf(r) < r.at_least) {
          const id = best(s, s.courseIds.filter((x) => countsToward(r, x) && !breaksCeiling(x)));
          if (!id) break;
          assign(s, id);
        }
      }
      // A language sequence stays in one language: the one the student
      // already has credits in (the audit's need pool is that prefix), or
      // the first one picked.
      const prefix = () => (s.sequence ? [...s.counted.map((x) => x.courseId), ...(filled.get(s.slotId) ?? [])][0]?.slice(0, 3) : undefined);
      while (!slotFull(s, filled, credits)) {
        const p = prefix();
        const id = best(s, s.courseIds.filter((x) => !breaksCeiling(x) && (!p || x.startsWith(p))));
        if (!id) break;
        assign(s, id);
      }
    }
  };
  choose();

  // 3. Close over prerequisites and tracking --------------------------------
  const addPrereqs = () => {
    for (let round = 0; round < MAX_PREREQ_DEPTH; round++) {
      const have = new Set([...held, ...chosen.keys()]);
      let added = false;
      for (const c of [...chosen.values()]) {
        // Corequisites the plan doesn't hold yet: the cheapest route through
        // the corequisite tree, taken in the same term or earlier.
        const co = catalog.courses[c.courseId]?.corequisite?.tree;
        if (co)
          for (const id of walk(catalog, co, have, 0, new Set([c.courseId])).courses)
            if (!chosen.has(id) && !have.has(id)) {
              chosen.set(id, { courseId: id, why: "corequisite", slotIds: [], locked: null, deadline: null, notes: [{ code: "prerequisite_chain", message: `A corequisite of ${displayCode(catalog, c.courseId)}.`, courseIds: [c.courseId] }] });
              have.add(id);
              added = true;
            }
        const need = missingPrereqs(catalog, c.courseId, have, 0, new Set());
        for (const id of need.courses)
          if (!chosen.has(id) && !have.has(id)) {
            chosen.set(id, { courseId: id, why: "prerequisite", slotIds: [], locked: null, deadline: null, notes: [{ code: "prerequisite_chain", message: `Needed before ${displayCode(catalog, c.courseId)}.`, courseIds: [c.courseId] }] });
            have.add(id);
            added = true;
          }
      }
      if (!added) break;
    }
  };
  addPrereqs();

  const deadlines: Deadline[] = programIds.flatMap((pid) => trackingDeadlines(catalog, record, pid, history));
  for (const d of deadlines) {
    if (d.missed)
      blockers.push({ code: "deadline_unreachable", message: missedMessage(catalog, d) });
    let need = d.needed;
    const due = d.missed ? start : d.dueTerm;
    const inPlan = (set: string[]) => set.every((id) => chosen.has(id) || held.has(id));
    // "7 of these 8 by semester 7": take the slots that can be finished
    // soonest (already planned, then the shortest prerequisite chain), not
    // one at the end of a chain whose first course would be due in the past.
    // The chain is counted from what the student holds, not what is planned:
    // a planned prerequisite still takes a term.
    const chain = (slot: string[][]) =>
      Math.min(...slot.map((set) => set.reduce((n, id) => n + (held.has(id) ? 0 : 1 + prereqOf(id).courses.length), 0)));
    const standing = (slot: string[][]) => Math.min(...slot.map((set) => Math.max(0, ...set.map((id) => (held.has(id) ? 0 : prereqOf(id).standing)))));
    const ordered = [...d.open].sort((a, b) => Number(!a.some(inPlan)) - Number(!b.some(inPlan)) || chain(a) - chain(b) || standing(a) - standing(b));
    for (const slot of ordered) {
      if (need <= 0) break;
      const set = slot.find(inPlan) ?? slot.find((s) => s.every((id) => catalog.courses[id] && !banned.has(id)));
      if (!set) continue;
      for (const id of set) {
        if (held.has(id)) continue;
        const c = chosen.get(id) ?? { courseId: id, why: "tracking" as const, slotIds: [], locked: null, deadline: null, notes: [] };
        c.deadline = c.deadline && compareTerms(c.deadline, due) <= 0 ? c.deadline : due;
        chosen.set(id, c);
      }
      need--;
    }
  }
  addPrereqs();

  // A course no plan can make eligible (a program restriction, a prerequisite
  // that left the catalog) is swapped for the slot's next option, once.
  const finalRecord = () => recordAfter(record, [...chosen.values()].map((c) => ({ courseId: c.courseId, term: target, credits: credits(c.courseId) })), target);
  {
    const rec = finalRecord();
    const h = new CourseHistory(rec, catalog);
    const after = nextTerm(nextTerm(nextTerm(target)));
    let swapped = false;
    for (const c of [...chosen.values()]) {
      if (c.why === "locked") continue;
      const e = evaluateEligibility(catalog, rec, c.courseId, after, {}, h);
      if (e.status !== "not_eligible") continue;
      if (c.slotIds.some((sid) => slots.find((s) => s.slotId === sid)?.kind !== "course")) {
        banned.add(c.courseId);
        chosen.delete(c.courseId);
        for (const [sid, ids] of filled) filled.set(sid, ids.filter((x) => x !== c.courseId));
        for (const set of usedIn.values()) set.clear();
        swapped = true;
      }
    }
    if (swapped) {
      // Rebuild the domain bookkeeping from what is still chosen, then refill.
      usedIn.clear();
      for (const [sid, ids] of filled) {
        const s = slots.find((x) => x.slotId === sid)!;
        for (const id of ids) {
          if (!usedIn.has(id)) usedIn.set(id, new Set());
          usedIn.get(id)!.add(domainKey(s));
        }
      }
      for (const c of chosen.values()) c.slotIds = [...filled].filter(([, ids]) => ids.includes(c.courseId)).map(([sid]) => sid);
      choose();
      addPrereqs();
    }
  }

  // Deadlines flow down prerequisite chains: a prerequisite of a course due
  // in fall is due the term before.
  const dependents = new Map<string, Set<string>>();
  for (const c of chosen.values())
    for (const id of courseLeaves(catalog.courses[c.courseId]?.prerequisite?.tree ?? null))
      if (chosen.has(id)) (dependents.get(id) ?? dependents.set(id, new Set()).get(id)!).add(c.courseId);
  const effectiveDeadline = (id: string, seen = new Set<string>()): Term | null => {
    if (seen.has(id)) return null;
    seen.add(id);
    let d = chosen.get(id)?.deadline ?? null;
    for (const dep of dependents.get(id) ?? []) {
      const dd = effectiveDeadline(dep, seen);
      const before = dd && previousRegular(dd);
      if (before && (!d || compareTerms(before, d) < 0)) d = before;
    }
    return d;
  };
  const unlocks = (id: string, seen = new Set<string>()): number => {
    let n = 0;
    for (const dep of dependents.get(id) ?? []) if (!seen.has(dep)) { seen.add(dep); n += 1 + unlocks(dep, seen); }
    return n;
  };
  const modelIndex = new Map<string, number>();
  for (const pid of programIds) for (const e of catalog.programs[pid].modelPlan) if (e.courseId && !modelIndex.has(e.courseId)) modelIndex.set(e.courseId, e.semesterIndex);

  // 4. Schedule ----------------------------------------------------------
  const terms = termsBetween(start, target, options.summer ?? false);
  const lockedTerms = new Set((options.lockedTerms ?? []).map(termCode));
  const capOf = (t: Term) => options.termCaps?.find((c) => compareTerms(c.term, t) === 0)?.credits ?? options.creditCap ?? DEFAULT_CREDIT_CAP;
  const placed = new Map<string, Term>();
  const load = { terms, credits: options.assumedTermLoad ?? ASSUMED_TERM_LOAD };
  const planTerms: PlanTerm[] = terms.map((t) => ({ term: t, courses: [], credits: 0, creditCap: capOf(t), locked: lockedTerms.has(termCode(t)) }));
  const termOf = (t: Term) => planTerms.find((p) => compareTerms(p.term, t) === 0);
  const entries = (): PlannedEntry[] => [...placed].map(([courseId, term]) => ({ courseId, term, credits: credits(courseId) }));
  const reasonsLast = new Map<string, Reason[]>();
  const everEligible = new Set<string>();
  const everOffered = new Set<string>();

  const plannedCourse = (c: Chosen, t: Term, notes: Reason[]): PlannedCourse => {
    const o = offeringOf(catalog, c.courseId, t);
    const course = catalog.courses[c.courseId];
    const extra: Reason[] = [];
    if (course?.creditsMin === null || course?.creditsMin === undefined)
      extra.push({ code: "rule_not_modeled", message: `The catalog gives no credits for ${displayCode(catalog, c.courseId)}; ${ASSUMED_CREDITS} are assumed.` });
    else if (course.creditsMax !== null && course.creditsMax !== course.creditsMin)
      extra.push({ code: "rule_not_modeled", message: `${displayCode(catalog, c.courseId)} is variable credit (${course.creditsMin}-${course.creditsMax}); planned at ${course.creditsMin}.` });
    if (o.status !== "confirmed") extra.push({ code: "offering_unconfirmed", message: o.message, courseIds: [c.courseId] });
    return {
      courseId: c.courseId,
      label: displayCode(catalog, c.courseId),
      why: c.why,
      slotIds: c.slotIds,
      credits: credits(c.courseId),
      locked: c.locked !== null,
      offering: o.status === "confirmed" ? "confirmed" : o.status === "historical" ? "historical" : "unconfirmed",
      deadline: effectiveDeadline(c.courseId),
      notes: [...c.notes, ...notes, ...extra],
    };
  };

  // Locked courses go where the student put them, whatever the checks say;
  // a check that fails is a locked_conflict blocker.
  for (const c of chosen.values()) {
    if (!c.locked) continue;
    const pt = termOf(c.locked);
    if (!pt) {
      blockers.push({ code: "locked_conflict", message: `${displayCode(catalog, c.courseId)} is locked to ${termName(c.locked)}, outside this plan's terms (${termName(start)} to ${termName(target)}).`, courseIds: [c.courseId] });
      continue;
    }
    placed.set(c.courseId, c.locked);
  }
  for (const pt of planTerms) {
    const here = [...chosen.values()].filter((c) => c.locked && compareTerms(c.locked, pt.term) === 0);
    if (!here.length) continue;
    const rec = recordAtStartOf(record, entries().filter((e) => compareTerms(e.term, pt.term) < 0), pt.term, load);
    const h = new CourseHistory(rec, catalog);
    for (const c of here) {
      const e = evaluateEligibility(catalog, rec, c.courseId, pt.term, { concurrent: here.map((x) => x.courseId) }, h);
      const notes: Reason[] = [];
      if (e.status === "not_eligible")
        blockers.push({ code: "locked_conflict", message: `${displayCode(catalog, c.courseId)} is locked to ${termName(pt.term)}, but its requisites won't be met then: ${e.reasons.map((r) => r.message).join(" ")}`, courseIds: [c.courseId] });
      else if (e.status === "unknown") notes.push(...e.reasons);
      if (offeringOf(catalog, c.courseId, pt.term).status === "not_scheduled")
        blockers.push({ code: "locked_conflict", message: `${displayCode(catalog, c.courseId)} is locked to ${termName(pt.term)}, but isn't in that term's published schedule.`, courseIds: [c.courseId] });
      pt.courses.push(plannedCourse(c, pt.term, notes));
      pt.credits += credits(c.courseId);
    }
    if (pt.credits > pt.creditCap + 1e-9)
      blockers.push({ code: "locked_conflict", message: `${termName(pt.term)} has ${pt.credits} locked credits, over its ${pt.creditCap}-credit cap.` });
  }

  const offeredIn = (id: string, t: Term) => {
    const o = offeringOf(catalog, id, t);
    if (o.status === "confirmed" || o.status === "historical" || o.status === "unknown") return true;
    // A course with no sections in any term read can't be ruled out by season.
    return o.status === "not_seen" && !(catalog.schedule.offeredTerms[id]?.length);
  };
  const priority = (id: string): (number | string)[] => {
    const d = effectiveDeadline(id);
    return [d ? termCode(d) : "9999", -unlocks(id), modelIndex.get(id) ?? 99, courseLevel(id), id];
  };

  for (const pt of planTerms) {
    if (pt.locked) continue;
    const rec = recordAtStartOf(record, entries().filter((e) => compareTerms(e.term, pt.term) < 0), pt.term, load);
    const h = new CourseHistory(rec, catalog);
    const tryPlace = (ids: string[], notesFor: Map<string, Reason[]>) => {
      const add = ids.reduce((n, id) => n + credits(id), 0);
      if (pt.credits + add > pt.creditCap + 1e-9) return false;
      for (const id of ids) {
        placed.set(id, pt.term);
        pt.courses.push(plannedCourse(chosen.get(id)!, pt.term, notesFor.get(id) ?? []));
        pt.credits += credits(id);
      }
      return true;
    };
    let progress = true;
    while (progress) {
      progress = false;
      const pool = [...chosen.keys()].filter((id) => !placed.has(id)).sort((a, b) => cmp(priority(a), priority(b)));
      for (const id of pool) {
        if (placed.has(id) || !offeredIn(id, pt.term)) continue;
        everOffered.add(id);
        const here = pt.courses.flatMap((c) => (c.courseId ? [c.courseId] : []));
        const e = evaluateEligibility(catalog, rec, id, pt.term, { concurrent: here }, h);
        const notes = new Map<string, Reason[]>();
        if (e.status === "not_eligible") {
          // A corequisite that a still-unplaced course would satisfy: place them together.
          const partners = [...new Set(courseLeaves(catalog.courses[id]?.corequisite?.tree ?? null))].filter((p) => p !== id && chosen.has(p) && !placed.has(p) && offeredIn(p, pt.term));
          const preOk = e.prerequisite === null || e.prerequisite.value !== "not_met";
          if (!partners.length || !preOk) {
            reasonsLast.set(id, e.reasons);
            continue;
          }
          const withPartners = evaluateEligibility(catalog, rec, id, pt.term, { concurrent: [...here, ...partners] }, h);
          const partnersOk = partners.every((p) => evaluateEligibility(catalog, rec, p, pt.term, { concurrent: [...here, id, ...partners] }, h).status !== "not_eligible");
          if (withPartners.status === "not_eligible" || !partnersOk) {
            reasonsLast.set(id, withPartners.reasons);
            continue;
          }
          everEligible.add(id);
          if (tryPlace([id, ...partners], notes)) progress = true;
          continue;
        }
        everEligible.add(id);
        if (e.status === "unknown") notes.set(id, e.reasons);
        if (tryPlace([id], notes)) progress = true;
      }
    }
  }

  // Prose slots get reserved hours in the first terms with room.
  const placeholders: { slot: Slot; placed: boolean }[] = slots.filter((s) => s.kind === "credits" && s.courseIds.length === 0).map((slot) => ({ slot, placed: false }));
  for (const p of placeholders) {
    const hours = p.slot.credits || ASSUMED_CREDITS;
    const pt = planTerms.find((t) => !t.locked && t.credits + hours <= t.creditCap + 1e-9);
    if (!pt) continue;
    pt.courses.push({
      courseId: null,
      label: p.slot.label,
      why: "placeholder",
      slotIds: [p.slot.slotId],
      credits: hours,
      locked: false,
      offering: "unconfirmed",
      deadline: null,
      notes: [{ code: "rule_not_modeled", message: `The catalog describes this in prose ("${p.slot.label}"); pick a course with an advisor.` }],
    });
    pt.credits += hours;
    p.placed = true;
  }

  // What couldn't be placed, and why.
  const unplacedCourses: Plan["unplacedCourses"] = [];
  for (const c of chosen.values()) {
    if (placed.has(c.courseId)) continue;
    const code = displayCode(catalog, c.courseId);
    let reason: Reason;
    if (!everOffered.has(c.courseId))
      reason = { code: "not_offered", message: `${code} isn't offered in any planned term (by the published schedules and past ${options.summer ? "terms" : "fall/spring terms"}).`, courseIds: [c.courseId] };
    else if (!everEligible.has(c.courseId))
      reason = { code: "prerequisite_chain", message: `${code}'s requisites aren't met in any planned term: ${(reasonsLast.get(c.courseId) ?? []).map((r) => r.message).join(" ") || "see its prerequisites."}`, courseIds: [c.courseId] };
    else reason = { code: "credit_cap", message: `${code} has no room left under the credit caps by ${termName(target)}.`, courseIds: [c.courseId] };
    unplacedCourses.push({ courseId: c.courseId, label: code, slotIds: c.slotIds, credits: credits(c.courseId), reasons: [reason] });
  }
  for (const p of placeholders)
    if (!p.placed)
      unplacedCourses.push({ courseId: null, label: p.slot.label, slotIds: [p.slot.slotId], credits: p.slot.credits || ASSUMED_CREDITS, reasons: [{ code: "credit_cap", message: `No term has room for ${p.slot.credits || ASSUMED_CREDITS} credits of "${p.slot.label}".` }] });
  for (const c of chosen.values()) {
    const d = effectiveDeadline(c.courseId);
    const t = placed.get(c.courseId);
    if (d && (!t || compareTerms(t, d) > 0))
      blockers.push({ code: "deadline_unreachable", message: `${displayCode(catalog, c.courseId)} is needed by ${termName(d)} for Critical Tracking${t ? `, but the earliest the plan fits it is ${termName(t)}` : ", and the plan can't place it"}.`, courseIds: [c.courseId] });
  }
  for (const u of unplacedCourses) blockers.push(...u.reasons);

  const placedSlot = (s: Slot): boolean => {
    const courses = planTerms.flatMap((t) => t.courses).filter((c) => c.slotIds.includes(s.slotId));
    if (s.kind === "credits") return courses.reduce((n, c) => n + c.credits, 0) + 1e-9 >= s.credits && (s.credits > 0 || courses.length > 0 || s.rules.length === 0);
    return courses.length > 0;
  };
  const unplacedSlots = slots.filter((s) => !placedSlot(s));
  for (const s of unplacedSlots)
    if (!unplacedCourses.some((u) => u.slotIds.includes(s.slotId)))
      blockers.push({ code: "requirements_remaining", message: `No course could be chosen for "${s.label}" (every option is held elsewhere, unavailable or can't be taken).` });

  // 5. Check with the validator -------------------------------------------
  const strip = (s: Slot): RequirementSlot => ({ slotId: s.slotId, programId: s.programId, requirementKey: s.requirementKey, section: s.section, kind: s.kind, courseIds: s.courseIds, credits: s.credits, label: s.label });
  const draft = {
    terms: planTerms.map((t) => ({ term: t.term, courses: t.courses.flatMap((c) => (c.courseId ? [c.courseId] : [])) })),
    programIds,
    creditCap: Math.max(...planTerms.map((t) => t.creditCap)),
    assumedTermLoad: load.credits,
  };
  const check = validatePlan(catalog, record, draft);
  const known = new Set(blockers.map((b) => b.message));
  for (const i of check.issues) {
    if (i.severity !== "error" || i.code === "credit_cap") continue;
    // Requirements the plan leaves open because a slot is unplaced are
    // already explained; prose placeholders satisfy nothing the audit can see.
    if (i.code === "requirements_remaining" && (unplacedSlots.length || blockers.length)) continue;
    if (!known.has(i.message)) blockers.push({ code: i.code, message: i.message, ...(i.courseIds ? { courseIds: i.courseIds } : {}) });
  }

  const historical = planTerms.flatMap((t) => t.courses).filter((c) => c.offering !== "confirmed").length;
  assumptions.push({ code: "in_progress_pending", message: "Every current and planned course is assumed passed, with the grade later courses require." });
  if (historical)
    assumptions.push({ code: "offering_unconfirmed", message: `${historical} planned course(s) are in terms whose schedules aren't published: offerings are inferred from past semesters, not confirmed.` });
  if (load.credits > 0)
    assumptions.push({ code: "rule_not_modeled", message: `For class standing, each planned fall/spring term is assumed to total at least ${load.credits} credits (UF's full-time load); hours the plan doesn't name are free electives.` });
  if (options.creditCap === undefined) assumptions.push({ code: "rule_not_modeled", message: `${DEFAULT_CREDIT_CAP} credits per term is the planner's default, not a UF rule.` });
  assumptions.push({ code: "program_rules_not_captured", message: "The plan covers the listed requirements only: a degree's minimum total credits, free electives and residency rules aren't planned." });

  const earned = history.earnedByCourse();
  const sum = (hs: { credits: number }[]) => hs.reduce((n, h) => n + h.credits, 0);
  const status = blockers.length || unplacedSlots.length || unplacedCourses.length ? "infeasible" : "feasible";
  return Plan.parse({
    versions: resultVersions(catalog, record),
    planId: options.planId ?? `plan-${record.recordId}-${record.recordVersion}`,
    programIds,
    basis,
    status,
    startTerm: start,
    targetTerm: target,
    terms: planTerms,
    slots: slots.map(strip),
    unplacedSlots: unplacedSlots.map(strip),
    unplacedCourses,
    blockers: status === "infeasible" && blockers.length === 0 ? [{ code: "requirements_remaining", message: "Some requirements couldn't be placed." }] : dedupe(blockers),
    assumptions,
    totals: { planned: planTerms.reduce((n, t) => n + t.credits, 0), earned: sum(earned.completed) + history.electiveCredits(), inProgress: sum(earned.pending) },
    options,
  });
}

/** Options that regenerate a plan with everything the student locked kept
 *  in place: the plan's own locks, its locked terms' courses, and any
 *  course marked `locked` in it. */
export function regenerationOptions(plan: Plan, changes: Partial<PlanOptions> = {}): PlanOptions {
  const locks = new Map<string, { course: string; term: Term }>();
  for (const l of plan.options.locks ?? []) locks.set(toCourseId(l.course), { course: toCourseId(l.course), term: l.term });
  for (const t of plan.terms)
    for (const c of t.courses) if (c.courseId && (c.locked || t.locked)) locks.set(c.courseId, { course: c.courseId, term: t.term });
  const lockedTerms = [...(plan.options.lockedTerms ?? []), ...plan.terms.filter((t) => t.locked).map((t) => t.term)];
  return {
    ...plan.options,
    ...changes,
    locks: [...locks.values(), ...(changes.locks ?? [])],
    lockedTerms: dedupeTerms([...lockedTerms, ...(changes.lockedTerms ?? [])]),
  };
}

// ---------------------------------------------------------------------------
// Slots from needs
// ---------------------------------------------------------------------------

function slotsFor(catalog: Catalog, programId: string, group: RequirementGroup, need: Need, name: string): Slot[] {
  const base = {
    programId,
    requirementKey: group.key,
    section: group.section,
    domain: countingDomain(group) ?? "options",
    broad: isBroadPool(group),
    sequence: group.logic.is_sequence === true,
    rules: [] as CountRule[],
    counted: [] as { courseId: string; credits: number }[],
  };
  const credits = (id: string) => catalog.courses[id]?.creditsMin ?? ASSUMED_CREDITS;
  const id = (part: string) => `${programId}/${group.key}#${part}`;
  const courseSlot = (c: string, label: string): Slot => ({ ...base, slotId: id(c), kind: "course", courseIds: [c], credits: credits(c), label });
  const real = (ids: readonly string[]) => ids.filter((c) => /^[a-z]{3}\d{4}[a-z]?$/.test(c));
  switch (need.kind) {
    case "slots": {
      // Each unfilled slot keeps its position in the catalog's list (a stable
      // id), matched to a position not used yet: three identical "Elective"
      // rows are three slots.
      const shape = groupShape(group);
      const all = shape.kind === "slots" ? shape.slots : [];
      const used = new Set<number>();
      return need.slots.map((s): Slot => {
        const index = all.findIndex((a, i) => !used.has(i) && JSON.stringify(a) === JSON.stringify(s));
        used.add(index);
        const courses = real(s.courses);
        if (courses.length === 1) return courseSlot(courses[0], `${name}: ${displayCode(catalog, courses[0])}`);
        if (courses.length >= 2)
          return { ...base, slotId: id(String(index + 1)), kind: "choice", courseIds: courses, credits: Math.min(...courses.map(credits)), label: `${name}: one of ${courses.slice(0, 4).map((c) => displayCode(catalog, c)).join(", ")}${courses.length > 4 ? ", ..." : ""}` };
        const prose = s.prose[0];
        return { ...base, slotId: id(`open${index + 1}`), kind: "credits", courseIds: [], credits: prose?.credits ?? ASSUMED_CREDITS, label: `${name}: ${prose?.label ?? "open slot"}` };
      });
    }
    case "options": {
      // The option the student follows, else the one with the fewest credits.
      const sized = need.options.map((o, i) => ({ o: real(o), i, credits: real(o).reduce((n, c) => n + credits(c), 0) })).filter((x) => x.o.length);
      const pick = need.started ? sized[0] : [...sized].sort((a, b) => a.credits - b.credits || a.i - b.i)[0];
      if (!pick) return [];
      return pick.o.map((c) => courseSlot(c, `${name} (${need.labels[pick.i] ?? `option ${pick.i + 1}`}): ${displayCode(catalog, c)}`));
    }
    case "credits":
      return [{ ...base, rules: need.rules, counted: need.counted, slotId: id("credits"), kind: "credits", courseIds: real(need.pool), credits: need.credits, label: need.pool.length ? `${name}: ${need.credits} credits` : `${name} (${need.credits} credits, described in prose)` }];
    case "count": {
      const pool = real(need.pool);
      if (pool.length === 0) return [{ ...base, slotId: id("open"), kind: "credits", courseIds: [], credits: need.count * ASSUMED_CREDITS, label: `${name} (${need.count} course${need.count > 1 ? "s" : ""}, described in prose)` }];
      return Array.from({ length: need.count }, (_, i): Slot =>
        pool.length === 1 ? courseSlot(pool[0], `${name}: ${displayCode(catalog, pool[0])}`) : { ...base, slotId: id(String(i + 1)), kind: "choice", courseIds: pool, credits: Math.min(...pool.map(credits)), label: `${name}: course ${i + 1} of ${need.count}` },
      ).filter((s, i, all) => all.findIndex((x) => x.slotId === s.slotId) === i);
    }
  }
}

/** Fixed courses, then choices with the fewest options, then credit pools
 *  (broad ones last), then prose. Ties in catalog order (stable sort). */
function slotOrder(slots: readonly Slot[]): Slot[] {
  const rank = (s: Slot) =>
    s.kind === "course" ? 0 : s.kind === "choice" ? 1 : s.courseIds.length === 0 ? 4 : s.broad ? 3 : 2;
  return [...slots].sort((a, b) => rank(a) - rank(b) || (a.kind === "choice" && b.kind === "choice" ? a.courseIds.length - b.courseIds.length : 0));
}

function slotFull(s: Slot, filled: ReadonlyMap<string, string[]>, credits: (id: string) => number): boolean {
  const ids = filled.get(s.slotId) ?? [];
  if (s.kind !== "credits") return ids.length > 0;
  const have = ids.reduce((n, id) => n + credits(id), 0);
  const floors = s.rules.every((r) => {
    if (r.at_least === undefined) return true;
    const t = [...s.counted, ...ids.map((id) => ({ courseId: id, credits: credits(id) }))]
      .filter((x) => countsToward(r, x.courseId))
      .reduce((n, x) => n + (r.unit === "credits" ? x.credits : 1), 0);
    return t >= r.at_least;
  });
  return have + 1e-9 >= s.credits && floors;
}

const countsToward = (rule: CountRule, id: string) =>
  (!rule.prefixes || rule.prefixes.includes(id.slice(0, 3))) &&
  (rule.min_level === undefined || Number(id.slice(3, 7)) >= rule.min_level);

// ---------------------------------------------------------------------------
// Prerequisite closure
// ---------------------------------------------------------------------------

/** standing: the earned credits the route's standing leaves ask for (a
 *  freshman can't take a "sophomore standing" course in semester 1). */
type PrereqNeed = { courses: string[]; unknown: boolean; impossible: boolean; standing: number };

/** The courses still to take before `courseId` can be: the cheapest route
 *  through its prerequisite tree, given `have` (held or already planned).
 *  Leaves the engine decides only at registration (standing, permission,
 *  GPA, program, unparsed text) add no courses; they're checked when the
 *  course is scheduled. */
function missingPrereqs(catalog: Catalog, courseId: string, have: ReadonlySet<string>, depth: number, path: Set<string>): PrereqNeed {
  const tree = catalog.courses[courseId]?.prerequisite?.tree ?? null;
  if (!catalog.courses[courseId]?.prerequisite) return { courses: [], unknown: false, impossible: false, standing: 0 };
  if (!tree) return { courses: [], unknown: true, impossible: false, standing: 0 };
  path.add(courseId);
  const out = walk(catalog, tree, have, depth, path);
  path.delete(courseId);
  return out;
}

function walk(catalog: Catalog, node: RequisiteNode, have: ReadonlySet<string>, depth: number, path: Set<string>): PrereqNeed {
  const credits = (ids: string[]) => ids.reduce((n, id) => n + (catalog.courses[id]?.creditsMin ?? ASSUMED_CREDITS), 0);
  switch (node.type) {
    case "and": {
      const parts = node.items.map((n) => walk(catalog, n, have, depth, path));
      return { courses: [...new Set(parts.flatMap((p) => p.courses))], unknown: parts.some((p) => p.unknown), impossible: parts.some((p) => p.impossible), standing: Math.max(0, ...parts.map((p) => p.standing)) };
    }
    case "or": {
      const parts = node.items.map((n) => walk(catalog, n, have, depth, path));
      return [...parts].sort((a, b) => Number(a.impossible) - Number(b.impossible) || credits(a.courses) - credits(b.courses) || a.standing - b.standing || Number(a.unknown) - Number(b.unknown))[0];
    }
    case "course": {
      const id = node.course_id;
      if (have.has(id)) return { courses: [], unknown: false, impossible: false, standing: 0 };
      if (!catalog.courses[id] || path.has(id)) return { courses: [], unknown: false, impossible: true, standing: 0 };
      if (depth >= MAX_PREREQ_DEPTH) return { courses: [id], unknown: true, impossible: false, standing: 0 };
      const below = missingPrereqs(catalog, id, have, depth + 1, path);
      return { courses: [...below.courses, id], unknown: below.unknown, impossible: below.impossible, standing: below.standing };
    }
    case "standing":
      return { courses: [], unknown: false, impossible: false, standing: STANDING_CREDITS[node.level] ?? 0 };
    default:
      return { courses: [], unknown: true, impossible: false, standing: 0 };
  }
}

function courseLeaves(node: RequisiteNode | null): string[] {
  if (!node) return [];
  if (node.type === "and" || node.type === "or") return node.items.flatMap(courseLeaves);
  return node.type === "course" ? [node.course_id] : [];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function termsBetween(start: Term, end: Term, summer: boolean): Term[] {
  const out: Term[] = [];
  for (let t = start; compareTerms(t, end) <= 0; t = nextTerm(t))
    if (summer || t.season !== "summer" || compareTerms(t, start) === 0 || compareTerms(t, end) === 0) out.push(t);
  return out;
}

function previousRegular(t: Term): Term {
  return t.season === "fall" ? { season: "spring", year: t.year } : { season: "fall", year: t.year - 1 };
}

function cmp(a: readonly (number | string)[], b: readonly (number | string)[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    return typeof a[i] === "number" ? (a[i] as number) - (b[i] as number) : String(a[i]).localeCompare(String(b[i]));
  }
  return 0;
}

function dedupe(rs: Reason[]): Reason[] {
  const seen = new Set<string>();
  return rs.filter((r) => (seen.has(r.message) ? false : (seen.add(r.message), true)));
}

function dedupeTerms(ts: Term[]): Term[] {
  const seen = new Set<string>();
  return ts.filter((t) => (seen.has(termCode(t)) ? false : (seen.add(termCode(t)), true)));
}
