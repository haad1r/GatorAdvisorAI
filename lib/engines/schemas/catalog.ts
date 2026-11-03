import { z } from "zod";
import { CatalogYear, CourseId, ProgramId, SourceReference } from "./common";
import { Grade } from "./record";

/**
 * The catalog as the engine reads it: what the scraper wrote to data/*.csv,
 * parsed into typed objects. These are INPUTS to the engine, owned by the
 * scraper; consumers (frontend, advisor) read results, not these.
 *
 * Field names are camelCase like every other contract, EXCEPT inside
 * `RequirementGroup.logic` and `RequisiteNode`, which keep the scraper's
 * snake_case keys exactly. Those two are the scraper's own rule formats
 * (documented in scraper/README.md); renaming them here would mean two
 * spellings of one format, and only the engine should look inside them.
 */

// ---------------------------------------------------------------------------
// Prerequisite / corequisite trees (data/catalog/requisites.csv `tree`)
// ---------------------------------------------------------------------------

/** One node of a parsed requisite. `and`/`or` combine; the rest are leaves.
 *  Only `course` and `credits` leaves can be decided from course history
 *  alone; the others need facts from the record (standing, program, GPA) or
 *  cannot be decided at all (permission, placement, equivalent, unparsed),
 *  which is why eligibility is three-valued. */
export type RequisiteNode =
  | { type: "and"; items: RequisiteNode[] }
  | { type: "or"; items: RequisiteNode[] }
  | { type: "course"; course_id: string; min_grade?: Grade; or_s?: boolean }
  | {
      type: "credits";
      min: number;
      prefixes?: string[];
      from?: string[];
      subject?: string;
      min_level?: number;
    }
  | { type: "standing"; level: string; or_higher?: boolean }
  | { type: "program"; code?: string; name?: string; kind?: string }
  | { type: "gpa"; min: number; scope?: string }
  | { type: "permission"; who?: string; text?: string }
  | { type: "placement"; text: string }
  | { type: "equivalent" }
  | { type: "unparsed"; text: string; mentions?: string[] };

export const RequisiteNode: z.ZodType<RequisiteNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("and"), items: z.array(RequisiteNode).min(1) }),
    z.strictObject({ type: z.literal("or"), items: z.array(RequisiteNode).min(1) }),
    // Not CourseId: a requisite may name a course that left the catalog, and
    // that is the engine's "unknown_course", not a load failure.
    // min_grade: "with a minimum grade of C" (2,216 leaves). or_s: an S grade
    // also satisfies it (84). Both appear only where UF states them.
    z.strictObject({
      type: z.literal("course"),
      course_id: z.string(),
      min_grade: Grade.optional(),
      or_s: z.boolean().optional(),
    }),
    z.strictObject({
      type: z.literal("credits"),
      min: z.number().nonnegative(),
      prefixes: z.array(z.string()).optional(),
      from: z.array(z.string()).optional(),
      subject: z.string().optional(),
      min_level: z.int().optional(),
    }),
    z.strictObject({
      type: z.literal("standing"),
      level: z.string(),
      or_higher: z.boolean().optional(),
    }),
    // Either UF's program code ("EVS_BA") or a name and kind ("Dance", "major").
    z
      .strictObject({
        type: z.literal("program"),
        code: z.string().optional(),
        name: z.string().optional(),
        kind: z.string().optional(),
      })
      .refine((p) => p.code !== undefined || p.name !== undefined, "a program leaf needs a code or a name"),
    z.strictObject({ type: z.literal("gpa"), min: z.number(), scope: z.string().optional() }),
    z.strictObject({
      type: z.literal("permission"),
      who: z.string().optional(),
      text: z.string().optional(),
    }),
    z.strictObject({ type: z.literal("placement"), text: z.string() }),
    z.strictObject({ type: z.literal("equivalent") }),
    z.strictObject({
      type: z.literal("unparsed"),
      text: z.string(),
      mentions: z.array(z.string()).optional(),
    }),
  ]),
);

export const Requisite = z.strictObject({
  kind: z.enum(["prereq", "coreq"]),
  /** complete: the whole text parsed. partial: parsed, with `unparsed` leaves.
   *  unparsed: nothing usable; the tree is a single `unparsed` leaf. */
  status: z.enum(["complete", "partial", "unparsed"]),
  tree: RequisiteNode.nullable(),
  rawText: z.string(),
});
export type Requisite = z.infer<typeof Requisite>;

// ---------------------------------------------------------------------------
// Courses (data/catalog/courses.csv, plus schedule-only rows from data/soc)
// ---------------------------------------------------------------------------

export const Course = z.strictObject({
  id: CourseId,
  code: z.string(),
  name: z.string(),
  /** Null only for schedule-only courses: the SOC lists them but the catalog
   *  does not, and SOC course rows carry no credit figure. */
  creditsMin: z.number().nonnegative().nullable(),
  creditsMax: z.number().nonnegative().nullable(),
  description: z.string(),
  grading: z.enum(["letter", "su"]).nullable(),
  genEd: z.array(z.string()),
  quest: z.string().nullable(),
  writingWords: z.int().nullable(),
  attributes: z.array(z.string()),
  deptSlug: z.string().nullable(),
  /** "catalog": in the 2026-27 course catalog. "schedule": seen only in the
   *  Schedule of Courses (244 such ids are referenced by program pages). */
  origin: z.enum(["catalog", "schedule"]),
  prerequisite: Requisite.nullable(),
  corequisite: Requisite.nullable(),
  source: SourceReference,
});
export type Course = z.infer<typeof Course>;

// ---------------------------------------------------------------------------
// Programs (data/programs/*.csv)
// ---------------------------------------------------------------------------

export const RuleType = z.enum(["required_list", "choose_credits", "choose_n"]);
export type RuleType = z.infer<typeof RuleType>;

/** major: the program's own requirements. geneed: UF general education the
 *  program page lists. college: college-wide (e.g. CLAS language). options:
 *  an alternative route or approved list, shown but never required. */
export const Section = z.enum(["major", "geneed", "college", "options"]);
export type Section = z.infer<typeof Section>;

/** A slot entry: a course id, or prose the page printed where a course would
 *  be ("Writing course, as approved by department"). */
export const SlotEntry = z.union([
  z.string(),
  z.strictObject({
    placeholder: z.string(),
    credits: z.number().optional(),
    semester: z.int().optional(),
  }),
]);

export const CountRule = z.looseObject({
  at_least: z.number().optional(),
  at_most: z.number().optional(),
  unit: z.enum(["courses", "credits"]),
  prefixes: z.array(z.string()).optional(),
  min_level: z.int().optional(),
  text: z.string(),
});

/** The scraper's rule detail for one group. Loose: the scraper adds keys
 *  over time (provenance like `heading`, `derived_from`), and the engine reads
 *  only the ones typed here. Course ids inside are plain strings for the same
 *  reason as in RequisiteNode. */
export const RequirementLogic = z.looseObject({
  /** required_list: each slot is satisfied by ANY one of its entries. */
  slots: z.array(z.union([z.array(SlotEntry), SlotEntry])).optional(),
  /** choose_credits / choose_n: the approved list. */
  from: z.array(z.string()).optional(),
  credits: z.number().nullable().optional(),
  n: z.int().optional(),
  /** Whole-option choosers: take every course of ONE option. */
  options: z.array(z.array(z.string())).optional(),
  option_labels: z.array(z.string()).optional(),
  is_sequence: z.boolean().optional(),
  /** Prose rows the parser kept instead of guessing ("PSB or EXP electives"). */
  placeholders: z.array(z.string()).optional(),
  placeholder_credits: z.array(z.number()).optional(),
  gened_area: z.string().optional(),
  /** A record fact that removes the group: "aa_or_60_credits",
   *  "language_placement_or_proficiency". */
  waived_by: z.string().optional(),
  /** Groups of one program sharing a name may not count the same course. */
  exclusive_set: z.string().optional(),
  count_rules: z.array(CountRule).optional(),
});
export type RequirementLogic = z.infer<typeof RequirementLogic>;

export const RequirementGroup = z.strictObject({
  programId: ProgramId,
  /** Unique within the program; `${programId}/${key}` is globally unique and
   *  is the requirement's stable identity. */
  key: z.string().min(1),
  name: z.string(),
  ruleType: RuleType,
  section: Section,
  logic: RequirementLogic,
  eligibleCourseIds: z.array(z.string()),
  requiredCredits: z.number().nonnegative().nullable(),
  requiredCourseCount: z.int().nonnegative().nullable(),
  sortOrder: z.int(),
});
export type RequirementGroup = z.infer<typeof RequirementGroup>;

/** A Critical Tracking row: what must be done by enrolled fall/spring
 *  semester `semester` (summers don't count, matching how UF states it).
 *  `courses`: every slot held. `count`: at least `count` slots held (-1:
 *  all of them; no slots: the model plan's tracking rows). `gpa`: a GPA of at
 *  least `gpaMin` over `gpaScope`. `note`: prose only, nothing to evaluate.
 *  A slot is a list of " or " alternatives; each alternative is an AND-set (a
 *  lecture with its lab). */
export const Milestone = z
  .strictObject({
    semester: z.int().min(1),
    kind: z.enum(["courses", "count", "gpa", "note"]),
    slots: z.array(z.array(z.array(z.string()))),
    count: z.int().nullable(),
    pool: z.array(z.string()),
    rawText: z.string(),
    /** The line's minimum grade for ALL its courses ("with a minimum grade
     *  of C"). Null: any passing grade, or a grade the line gives only one of
     *  its courses (not checked). "S" means S, or C or better. */
    minGrade: Grade.nullable(),
    gpaMin: z.number().min(0).max(4).nullable(),
    /** uf: the UF cumulative GPA. The others are GPAs over a subset of
     *  courses or institutions whose rules vary by page (see
     *  scraper/programs.py `_gpa_scope`). */
    gpaScope: z.enum(["uf", "critical_tracking", "upper_division", "all_institutions", "other"]).nullable(),
  })
  .refine((m) => (m.kind === "gpa") === (m.gpaMin !== null && m.gpaScope !== null), {
    message: "a gpa milestone (and only one) has gpaMin and gpaScope",
  });
export type Milestone = z.infer<typeof Milestone>;

/** One cell of UF's suggested semester grid (the "model plan"). */
export const ModelPlanEntry = z.strictObject({
  /** 1-based grid column. 0: the row came before any term header, i.e. the
   *  page's grid assigns it no semester (ugedu-uf_teach's grid has none). */
  semesterIndex: z.int().nonnegative(),
  position: z.int().nonnegative(),
  courseId: z.string().nullable(),
  placeholder: z.string().nullable(),
  credits: z.number().nullable(),
  isCriticalTracking: z.boolean(),
  isSummer: z.boolean(),
  /** Grid "or" choices: entries sharing altGroup are alternatives, numbered
   *  by altOption. */
  altGroup: z.int().nullable(),
  altOption: z.int().nullable(),
});
export type ModelPlanEntry = z.infer<typeof ModelPlanEntry>;

export const Program = z.strictObject({
  id: ProgramId,
  name: z.string(),
  kind: z.enum(["major", "minor", "certificate"]),
  degree: z.string().nullable(),
  collegeSlug: z.string(),
  /** published: QA passed (or a reviewed override). needs_review: the data
   *  could not be verified; the engine reports such a program as unknown. */
  status: z.enum(["published", "needs_review"]),
  confidence: z.number().min(0).max(1),
  catalogYear: CatalogYear,
  overrideReason: z.string().nullable(),
  source: SourceReference,
  requirements: z.array(RequirementGroup),
  milestones: z.array(Milestone),
  modelPlan: z.array(ModelPlanEntry),
});
export type Program = z.infer<typeof Program>;

// ---------------------------------------------------------------------------
// Exam credit (data/exam_credit/awards.csv)
// ---------------------------------------------------------------------------

export const ExamAward = z.strictObject({
  id: z.string().min(1),
  family: z.string(),
  exam: z.string(),
  minScore: z.number(),
  maxScore: z.number(),
  scoreLabel: z.string().nullable(),
  courseIds: z.array(CourseId),
  credits: z.number().nonnegative(),
  /** explicit: the table states the hours. table_note: a note on the table
   *  does. assumed_course: the awarded course's catalog credits. assumed:
   *  elective credit with no stated hours (3 assumed). */
  creditsSource: z.enum(["explicit", "table_note", "assumed", "assumed_course"]),
  genEd: z.array(z.string()),
  writingWords: z.int().nullable(),
  awardText: z.string(),
  source: SourceReference,
});
export type ExamAward = z.infer<typeof ExamAward>;

// ---------------------------------------------------------------------------
// The whole catalog
// ---------------------------------------------------------------------------

export const Catalog = z.strictObject({
  /** sha256 of the input files, first 16 hex chars. Changes exactly when the
   *  data changes, so it identifies "which data produced this result". */
  dataVersion: z.string().regex(/^[0-9a-f]{16}$/),
  catalogYear: CatalogYear,
  courses: z.record(CourseId, Course),
  programs: z.record(ProgramId, Program),
  examAwards: z.record(z.string(), ExamAward),
});
export type Catalog = z.infer<typeof Catalog>;
