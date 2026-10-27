import { displayCode } from "../history";
import type { Catalog, RequirementGroup } from "../schemas/catalog";
import type { Reason, ReasonCode } from "../schemas/common";
import { type RequisiteValue, combineAnd } from "../status";
import type { Held, Holdings } from "./held";
import { type OpenSlot, type Shape, coursesOf, groupShape, openSlotsOf } from "./shape";

/**
 * Evaluating ONE requirement group: claim courses for it from what is still
 * available, and say whether that meets it. The program audit (./index.ts)
 * calls this once per group in spend order. See ./README.md.
 *
 * The result is four-valued like a requisite: met (completed work alone),
 * pending (met if current courses pass), not_met, unknown.
 */

/** An advisor substitution that applies to this group. */
export type Substitute = { held: Held; replaces?: string };

export type GroupContext = {
  catalog: Catalog;
  holdings: Holdings;
  /** This domain's claims so far: courseId -> key of the group that took it.
   *  Null for a group that claims nothing (an options-section route). */
  claimed: Map<string, string> | null;
  /** May this group count `courseId` although group `ownerKey` has it?
   *  True only under an allow_overlap exception naming both. */
  overlapAllowed: (courseId: string, ownerKey: string) => boolean;
  /** Could a group still to claim in this domain use `courseId`? Such
   *  courses are taken last, so a later group isn't left short. */
  contested: (courseId: string) => boolean;
  substitutes: Substitute[];
  /** Display name of another group, for "counted toward X" messages. */
  nameOf: (key: string) => string;
};

export type GroupOutcome = {
  value: RequisiteValue;
  applied: Held[];
  pending: Held[];
  reasons: Reason[];
  /** Course ids that could still fill it, in catalog order. */
  remaining: string[];
  openSlots: OpenSlot[];
};

type CountRule = NonNullable<RequirementGroup["logic"]["count_rules"]>[number];

const code = (ctx: GroupContext, id: string) => displayCode(ctx.catalog, id);
const codes = (ctx: GroupContext, ids: readonly string[]) => ids.map((id) => code(ctx, id)).join(", ");

const countsToward = (rule: CountRule, id: string) =>
  (!rule.prefixes || rule.prefixes.includes(id.slice(0, 3))) &&
  (rule.min_level === undefined || Number(id.slice(3, 7)) >= rule.min_level);

function tally(rule: CountRule, held: readonly Held[]): number {
  return held
    .filter((h) => countsToward(rule, h.courseId))
    .reduce((n, h) => n + (rule.unit === "credits" ? h.holding.credits : 1), 0);
}

const ruleOk = (rule: CountRule, held: readonly Held[]) => {
  const n = tally(rule, held);
  return (rule.at_least === undefined || n >= rule.at_least) && (rule.at_most === undefined || n <= rule.at_most);
};

/** Builds one group's outcome. Keeps the claim bookkeeping in one place. */
class Claimer {
  readonly taken: Held[] = [];
  /** Held courses this group could use that another group already took. */
  readonly elsewhere = new Map<string, string>();
  readonly overlapped: string[] = [];

  constructor(
    readonly ctx: GroupContext,
    readonly key: string,
  ) {}

  /** The student's holding of `id` if this group may still claim it: the
   *  course itself, or a substitute standing in for it. */
  available(id: string): Held | undefined {
    const own = this.free(this.ctx.holdings.byCourse.get(id));
    if (own) return own;
    for (const s of this.ctx.substitutes) if (s.replaces === id && this.free(s.held)) return s.held;
    return undefined;
  }

  private free(held: Held | undefined): Held | undefined {
    if (!held || this.taken.includes(held)) return undefined;
    const owner = this.ctx.claimed?.get(held.courseId);
    if (owner === undefined || owner === this.key) return held;
    if (this.ctx.overlapAllowed(held.courseId, owner)) {
      this.overlapped.push(held.courseId);
      return held;
    }
    this.elsewhere.set(held.courseId, owner);
    return undefined;
  }

  /** Substitutes that name no course they replace: they count where the
   *  exception says, as an extra course of the group. */
  floating(): Held[] {
    return this.ctx.substitutes.filter((s) => !s.replaces && this.free(s.held)).map((s) => s.held);
  }

  take(h: Held) {
    this.taken.push(h);
    this.ctx.claimed?.set(h.courseId, this.key);
  }

  /** Claim order: completed before in progress, then courses that help an
   *  unmet floor rule, then uncontested before contested, then the course
   *  itself before a substitute, then catalog order (the sort is stable). */
  ordered(cands: Held[], helpsRule: (id: string) => boolean = () => false): Held[] {
    const rank = (h: Held) => [
      h.state === "completed" ? 0 : 1,
      helpsRule(h.courseId) ? 0 : 1,
      this.ctx.contested(h.courseId) ? 1 : 0,
      h.exceptionId ? 1 : 0,
    ];
    return [...cands].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      return 0;
    });
  }
}

function unknownReason(code: ReasonCode, message: string, courseIds?: string[]): Reason {
  return { code, message, ...(courseIds?.length ? { courseIds } : {}) };
}

// ---------------------------------------------------------------------------
// The four shapes
// ---------------------------------------------------------------------------

/** N credits or N courses from a list. Takes completed courses until the
 *  amount is met; only if they fall short, current courses too; if it is
 *  still short, everything available (so partial progress shows). */
function evaluatePool(
  c: Claimer,
  group: RequirementGroup,
  shape: Extract<Shape, { kind: "credits" | "count" }>,
): Omit<GroupOutcome, "reasons" | "remaining" | "openSlots"> & { notes: Reason[] } {
  const ctx = c.ctx;
  const notes: Reason[] = [];
  const unit = shape.kind === "credits" ? (h: Held) => h.holding.credits : () => 1;
  const word = shape.kind === "credits" ? "credits" : "courses";
  const rules = group.logic.count_rules ?? [];

  if (shape.needed === null || shape.needed === 0) {
    notes.push(unknownReason("rule_not_modeled", "The catalog states no amount for this requirement, so progress can't be measured."));
    return { value: "unknown", applied: [], pending: [], notes };
  }
  if (shape.pool.length === 0 && c.ctx.substitutes.length === 0) {
    notes.push(
      unknownReason(
        "rule_not_modeled",
        "The catalog describes the courses for this requirement in prose, not as a list, so which of the student's courses count can't be decided. An advisor substitution in the record can fill it.",
      ),
    );
    return { value: "unknown", applied: [], pending: [], notes };
  }

  const cands = [
    ...shape.pool.map((id) => c.available(id)).filter((h): h is Held => h !== undefined),
    ...c.floating(),
  ];
  const helps = (id: string) => rules.some((r) => r.at_least !== undefined && countsToward(r, id));
  const breaksCeiling = (h: Held) =>
    rules.some((r) => r.at_most !== undefined && countsToward(r, h.courseId) && tally(r, [...c.taken, h]) > r.at_most);
  // Completed courses come first in claim order, so current courses are
  // reached only when completed work falls short. A floor rule still unmet
  // keeps the claim going past the amount.
  let have = 0;
  for (const h of c.ordered(cands, helps)) {
    const floorsMet = rules.every((r) => r.at_least === undefined || ruleOk(r, c.taken));
    if (have >= shape.needed && floorsMet) break;
    if (breaksCeiling(h)) continue;
    c.take(h);
    have += unit(h);
  }

  const applied = c.taken.filter((h) => h.state === "completed");
  const pending = c.taken.filter((h) => h.state === "pending");
  const sum = (hs: Held[]) => hs.reduce((s, h) => s + unit(h), 0);
  const done = sum(applied);
  const total = done + sum(pending);
  let value: RequisiteValue = done >= shape.needed ? "met" : total >= shape.needed ? "pending" : "not_met";

  // Floors and ceilings inside the group ("at least one 4000-level course").
  for (const r of rules) {
    if (ruleOk(r, applied)) continue;
    if (value === "met" && ruleOk(r, c.taken) && pending.length) value = "pending";
    else if (!ruleOk(r, c.taken)) {
      value = "not_met";
      notes.push({ code: "count_rule_unmet", message: `${r.text} (${tally(r, c.taken)} ${r.unit} counting current courses).` });
    }
  }

  if (value === "not_met") {
    const ungraded = shape.pool.filter((id) => ctx.holdings.ungraded.has(id));
    if (ungraded.length) {
      notes.push(unknownReason("missing_grade", `${codes(ctx, ungraded)} has no grade recorded and could count here.`, ungraded));
      value = "unknown";
    } else if (total < shape.needed) {
      notes.push({
        code: "requirements_remaining",
        message: `${total} of ${shape.needed} ${word} counting current courses; ${shape.needed - total} more needed.`,
      });
    }
  }
  return { value, applied, pending, notes };
}

/** Each slot filled by one alternative. Slots with the fewest alternatives
 *  go first, so a course that fits two slots goes to the one that needs it. */
function evaluateSlots(
  c: Claimer,
  shape: Extract<Shape, { kind: "slots" }>,
): Omit<GroupOutcome, "reasons"> & { notes: Reason[] } {
  const ctx = c.ctx;
  const notes: Reason[] = [];
  if (shape.slots.length === 0) {
    notes.push(unknownReason("rule_not_modeled", "The catalog lists nothing to take for this requirement."));
    return { value: "unknown", applied: [], pending: [], notes, remaining: [], openSlots: [] };
  }
  const order = shape.slots
    .map((slot, i) => ({ slot, i }))
    .sort((a, b) => (a.slot.courses.length || Infinity) - (b.slot.courses.length || Infinity));
  const values: RequisiteValue[] = [];
  const unfilledAt: number[] = [];
  const filledAt = new Map<Held, number>();
  for (const { slot, i } of order) {
    const native = slot.courses.map((id) => c.available(id)).filter((h): h is Held => h !== undefined);
    const pick = c.ordered(native)[0] ?? c.ordered(c.floating())[0];
    if (pick) {
      c.take(pick);
      filledAt.set(pick, i);
      values.push(pick.state === "completed" ? "met" : "pending");
      continue;
    }
    unfilledAt.push(i);
    const ungraded = slot.courses.filter((id) => ctx.holdings.ungraded.has(id));
    if (ungraded.length) {
      values.push("unknown");
      notes.push(unknownReason("missing_grade", `${codes(ctx, ungraded)} has no grade recorded and could fill a slot here.`, ungraded));
    } else if (slot.prose.length) {
      values.push("unknown");
      const names = slot.prose.map((p) => `"${p.label}"`).join(", ");
      const alts = slot.courses.length ? ` (or ${slot.courses.map((id) => code(ctx, id)).join(" or ")})` : "";
      notes.push(unknownReason("rule_not_modeled", `${names}${alts} is described in prose; which courses fill it can't be decided.`));
    } else values.push("not_met");
  }
  const value = combineAnd(values);
  const unfilled = unfilledAt.sort((a, b) => a - b).map((i) => shape.slots[i]);
  const missing = unfilled.filter((s) => s.courses.length && !s.prose.length);
  if (value === "not_met" || (missing.length && value !== "met"))
    notes.push({
      code: "requirements_remaining",
      message: `Still needed: ${missing.map((s) => s.courses.map((id) => code(ctx, id)).join(" or ")).join("; ")}.`,
    });
  // Listed in the catalog's slot order, whatever order they were filled in.
  const inSlotOrder = [...c.taken].sort((a, b) => filledAt.get(a)! - filledAt.get(b)!);
  return {
    value,
    applied: inSlotOrder.filter((h) => h.state === "completed"),
    pending: inSlotOrder.filter((h) => h.state === "pending"),
    notes,
    remaining: [...new Set(unfilled.flatMap((s) => s.courses))].filter((id) => !ctx.holdings.byCourse.has(id)),
    openSlots: unfilled.flatMap((s) => s.prose),
  };
}

/** One whole option. The option followed is the one held in full (completed
 *  before pending), else the one held furthest, else the catalog's first. */
function evaluateOptions(
  c: Claimer,
  shape: Extract<Shape, { kind: "options" }>,
): Omit<GroupOutcome, "reasons" | "openSlots"> & { notes: Reason[] } {
  const ctx = c.ctx;
  const notes: Reason[] = [];
  const scored = shape.options.map((option, index) => {
    const held = option.map((id) => c.available(id));
    const got = held.filter((h): h is Held => h !== undefined);
    return {
      option,
      index,
      held,
      got,
      done: got.length === option.length && got.every((h) => h.state === "completed"),
      full: got.length === option.length,
    };
  });
  const best = [...scored].sort(
    (a, b) => Number(b.done) - Number(a.done) || Number(b.full) - Number(a.full) || b.got.length - a.got.length || a.index - b.index,
  )[0];
  for (const h of best.got) c.take(h);
  const missing = best.option.filter((_, i) => !best.held[i]);
  let value: RequisiteValue = best.done ? "met" : best.full ? "pending" : "not_met";
  if (value === "not_met") {
    const ungraded = missing.filter((id) => ctx.holdings.ungraded.has(id));
    if (ungraded.length) {
      value = "unknown";
      notes.push(unknownReason("missing_grade", `${codes(ctx, ungraded)} has no grade recorded and could complete an option here.`, ungraded));
    } else if (best.got.length)
      notes.push({ code: "requirements_remaining", message: `Following ${shape.labels[best.index]}: still needs ${codes(ctx, missing)}.` });
    else notes.push({ code: "requirements_remaining", message: `Needs every course of one option: ${shape.labels.join("; ")}.` });
  }
  const remaining = best.got.length ? missing : coursesOf(shape);
  return {
    value,
    applied: c.taken.filter((h) => h.state === "completed"),
    pending: c.taken.filter((h) => h.state === "pending"),
    notes,
    remaining: remaining.filter((id) => !ctx.holdings.byCourse.has(id)),
  };
}

// ---------------------------------------------------------------------------
// One group
// ---------------------------------------------------------------------------

export function evaluateGroup(group: RequirementGroup, ctx: GroupContext): GroupOutcome {
  const shape = groupShape(group);
  const c = new Claimer(ctx, group.key);
  let out: Omit<GroupOutcome, "reasons" | "remaining" | "openSlots"> & {
    notes: Reason[];
    remaining?: string[];
    openSlots?: OpenSlot[];
  };
  switch (shape.kind) {
    case "options":
      out = evaluateOptions(c, shape);
      break;
    case "slots":
      out = evaluateSlots(c, shape);
      break;
    default:
      out = evaluatePool(c, group, shape);
  }

  const reasons: Reason[] = [];
  if (out.pending.length)
    reasons.push({
      code: "in_progress_pending",
      message:
        out.value === "pending"
          ? `${codes(ctx, out.pending.map((h) => h.courseId))} (in progress) completes this when passed.`
          : `${codes(ctx, out.pending.map((h) => h.courseId))} (in progress) counts here when passed.`,
      courseIds: out.pending.map((h) => h.courseId),
    });
  reasons.push(...out.notes);
  if (out.value !== "met" && out.value !== "pending")
    for (const [id, owner] of c.elsewhere)
      reasons.push({
        code: "counted_elsewhere",
        message: `${code(ctx, id)} could count here but already counts toward ${ctx.nameOf(owner)}; a course counts toward one requirement unless an advisor allows overlap.`,
        courseIds: [id],
      });
  for (const h of c.taken.filter((t) => t.exceptionId))
    reasons.push({ code: "substitution_applied", message: `${code(ctx, h.courseId)} counts here by advisor substitution (${h.exceptionId}).`, courseIds: [h.courseId] });
  for (const id of new Set(c.overlapped.filter((id) => c.taken.some((t) => t.courseId === id))))
    reasons.push({ code: "overlap_allowed", message: `${code(ctx, id)} also counts elsewhere, by advisor exception.`, courseIds: [id] });

  const pool = shape.kind === "slots" || shape.kind === "options" ? [] : shape.pool;
  return {
    value: out.value,
    applied: out.applied,
    pending: out.pending,
    reasons,
    remaining:
      out.remaining ??
      (out.value === "met" || out.value === "pending" ? [] : pool.filter((id) => !ctx.holdings.byCourse.has(id))),
    openSlots: out.openSlots ?? (out.value === "met" ? [] : openSlotsOf(group)),
  };
}
