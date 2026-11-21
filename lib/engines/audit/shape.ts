import type { RequirementGroup } from "../schemas/catalog";

/**
 * How a requirement group is READ: which of four shapes it has, and which
 * courses can fill it. Decided from the catalog's data alone, before looking
 * at any record. See ./README.md for why each branch exists.
 *
 * Ported from UF Planner's lib/requirementShape.ts (groupShape) and
 * lib/groupOrder.ts (spendOrder). Changed from UF Planner: no rule pools or
 * hand attributions (our data has neither; record exceptions replace
 * attributions), and prose slots are kept as `prose` instead of dropped, so
 * the audit can say a slot is undecidable rather than pretend it isn't there.
 */

/** Prose the catalog printed where a course would be ("PSB or EXP electives
 *  at the 4000 level"). The engine can't decide which courses fill it. */
export type OpenSlot = { label: string; credits: number | null };

/** One slot of a required list: any one of `courses` fills it. A slot that
 *  also has `prose` alternatives can be filled by something the data doesn't
 *  name, so an unfilled one is unknown rather than unmet. */
export type Slot = { courses: string[]; prose: OpenSlot[] };

export type Shape =
  /** Every course of ONE option (Math's sequence pairs, a lecture + lab vs a
   *  combined course). */
  | { kind: "options"; options: string[][]; labels: string[] }
  /** N credits from a list. `needed` null: the catalog states no amount. */
  | { kind: "credits"; needed: number | null; pool: string[] }
  /** Any N courses from a list. */
  | { kind: "count"; needed: number; pool: string[] }
  /** Each slot filled by one of its alternatives. */
  | { kind: "slots"; slots: Slot[] };

/** The group's prose rows, paired with their credits when the data has them. */
export function openSlotsOf(group: RequirementGroup): OpenSlot[] {
  const labels = group.logic.placeholders ?? [];
  const credits = group.logic.placeholder_credits ?? [];
  return labels.map((label, i) => ({ label, credits: credits[i] ?? null }));
}

/** Decide a group's shape. The branch order is load-bearing:
 *
 *  1. Options first: read as a credit pool, "select one sequence" would be
 *     satisfied by any courses adding up to the credits, including pairs UF
 *     never printed. A language ladder (`is_sequence`) is not a choice of
 *     options; it falls through to credits.
 *  2. Credits: choose_credits, or a group with credits and no list at all.
 *  3. choose_n with no slots is "any N of the pool". Slicing the pool to N
 *     pretend slots would ask for N SPECIFIC courses (UF Planner shipped that
 *     bug on a 41-course geography pool).
 *  4. Slots for everything else. */
export function groupShape(group: RequirementGroup): Shape {
  const logic = group.logic;
  if (logic.options?.length && !logic.is_sequence) {
    const options = logic.options.filter((o) => o.length > 0);
    const labels = options.map((o, i) => logic.option_labels?.[i] ?? `Option ${i + 1}`);
    if (options.length) return { kind: "options", options, labels };
  }

  const pool = logic.from?.length ? logic.from : group.eligibleCourseIds;
  const credits = group.requiredCredits ?? logic.credits ?? null;
  if (group.ruleType === "choose_credits" || (pool.length === 0 && (credits ?? 0) > 0))
    return { kind: "credits", needed: credits, pool };

  if (group.ruleType === "choose_n" && !logic.slots?.length)
    return { kind: "count", needed: group.requiredCourseCount ?? logic.n ?? 0, pool };

  const raw = logic.slots?.length ? logic.slots : pool.map((id) => [id]);
  const slots = raw.map((s): Slot => {
    const entries = Array.isArray(s) ? s : [s];
    return {
      courses: entries.filter((e): e is string => typeof e === "string"),
      prose: entries
        .filter((e) => typeof e !== "string")
        .map((e) => ({ label: e.placeholder, credits: e.credits ?? null })),
    };
  });
  return { kind: "slots", slots };
}

/** Every course id the shape could use. */
export function coursesOf(shape: Shape): string[] {
  switch (shape.kind) {
    case "options":
      return [...new Set(shape.options.flat())];
    case "credits":
    case "count":
      return shape.pool;
    case "slots":
      return [...new Set(shape.slots.flatMap((s) => s.courses))];
  }
}

// ---------------------------------------------------------------------------
// Which groups compete for the same course, and in what order they claim
// ---------------------------------------------------------------------------

/** Groups in one domain compete: a course counts toward ONE of them. Groups
 *  in different domains may share a course. Null: the group claims nothing
 *  (an `options` section route is shown, never counted).
 *
 *  program: the major's and college's own requirements.
 *  geneed:  the gen ed subject areas (composition, humanities, ...).
 *  quest:   Quest 1 and 2, whose courses also carry area designations.
 *
 *  So PSY 2012 can be both the Psychology core course and a Social Science
 *  gen ed course, but not two rows of the Psychology major. */
export function countingDomain(group: RequirementGroup): string | null {
  if (group.section === "options") return null;
  if (group.section !== "geneed") return "program";
  return /^quest/.test(group.logic.gened_area ?? "") ? "quest" : "geneed";
}

/** A credit pool this broad is a menu, not a specific choice. Same threshold
 *  as UF Planner's BROAD_POOL_MIN_OPTIONS. */
export const BROAD_POOL_MIN_OPTIONS = 12;

/** A broad credit pool (gen ed areas, approved-elective lists). Not an
 *  options group, and not a model-plan spine that asks for every course it
 *  lists (typed choose_credits by the scraper, but really a required list). */
export function isBroadPool(group: RequirementGroup): boolean {
  if (group.ruleType !== "choose_credits" || group.logic.options?.length) return false;
  const n = group.eligibleCourseIds.length;
  if (group.logic.derived_from && n > 0 && (group.requiredCourseCount ?? 0) >= n) return false;
  return n >= BROAD_POOL_MIN_OPTIONS;
}

/** The order groups claim courses in: specific groups first, broad pools
 *  last, each half in catalog order. A broad pool takes whatever is left, so
 *  it must run after the groups that need particular courses; otherwise a
 *  60-course elective list could take the one course a required row needed.
 *  Display order is separate: results are listed in catalog order. */
export function spendOrder<G extends RequirementGroup>(groups: readonly G[]): G[] {
  const sorted = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);
  return [...sorted.filter((g) => !isBroadPool(g)), ...sorted.filter(isBroadPool)];
}
