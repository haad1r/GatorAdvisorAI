import type { CourseHistory } from "./history";
import type { Term } from "./schemas/common";
import type { Catalog } from "./schemas/catalog";
import type { AcademicRecord } from "./schemas/record";
import { evaluateTracking, planTrackingSlots, semesterTerm } from "./tracking";

/**
 * Critical Tracking as deadlines: which courses a program still needs by
 * which term. Read off the tracking engine's own result (a milestone it
 * can't check is not enforced), so the planner and the plan validator
 * enforce exactly the milestones the tracking result reports as open.
 */

/** A slot of a milestone: " or " alternatives, each an AND-set of courses. */
export type DeadlineSlot = string[][];

export type Deadline = {
  programId: string;
  /** Index into the program's milestones. */
  milestone: number;
  semester: number;
  dueTerm: Term;
  rawText: string;
  /** Due already and not met even counting current courses. */
  missed: boolean;
  /** How many more of `open` must be held by `dueTerm`. */
  needed: number;
  /** The milestone's slots the student doesn't hold yet. */
  open: DeadlineSlot[];
};

export function trackingDeadlines(
  catalog: Catalog,
  record: AcademicRecord,
  programId: string,
  history: CourseHistory,
): Deadline[] {
  const program = catalog.programs[programId];
  if (!program || program.milestones.length === 0) return [];
  const result = evaluateTracking(catalog, record, programId, history);
  const holds = (id: string) => {
    const v = history.best(id).value;
    return v === "met" || v === "pending";
  };
  const out: Deadline[] = [];
  program.milestones.forEach((m, i) => {
    const r = result.milestones[i];
    if (m.kind !== "courses" && m.kind !== "count") return;
    if (r.status !== "upcoming" && r.status !== "not_met") return;
    if (r.reasons.some((x) => x.code === "rule_not_modeled")) return;
    const slots = m.slots.length || m.kind !== "count" ? m.slots : planTrackingSlots(program, m.semester);
    if (slots.length === 0 || r.required === null) return;
    const covered = slots.filter((s) => s.some((set) => set.every(holds)));
    const open = slots.filter((s) => !covered.includes(s));
    const needed = Math.max(0, r.required - covered.length);
    if (needed === 0) return;
    out.push({
      programId,
      milestone: i,
      semester: m.semester,
      dueTerm: semesterTerm(record.firstTerm, m.semester),
      rawText: m.rawText,
      missed: r.status === "not_met",
      needed,
      open,
    });
  });
  return out;
}

const termName = (t: Term) => `${t.season[0].toUpperCase()}${t.season.slice(1)} ${t.year}`;

/** One wording for a milestone that has passed unmet, shared by the planner
 *  and the validator so a plan reports it once. */
export function missedMessage(catalog: Catalog, d: Deadline): string {
  return `${catalog.programs[d.programId].name}: the semester ${d.semester} Critical Tracking milestone (${termName(d.dueTerm)}) has passed unmet: "${d.rawText}". No plan can meet it now; UF reviews students who miss tracking, so an advisor must be involved.`;
}
