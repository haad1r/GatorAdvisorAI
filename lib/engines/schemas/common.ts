import { z } from "zod";

/**
 * Shared building blocks for every academic-engine contract.
 *
 * The contracts are zod schemas rather than bare TypeScript types because the
 * issue asks for runtime validation: a type disappears at compile time, while
 * a schema can reject a malformed record or result at the boundary where it
 * arrives (an API route, an AI tool call, a database row). Each schema also
 * exports its inferred type under the same name, so callers write `Term` for
 * both the value and the type.
 */

/** Version of the JSON shapes in this folder. Bump the minor for an additive
 *  field, the major for a rename or removal. Results carry it so a consumer
 *  can tell which shape it was handed. */
export const CONTRACT_VERSION = "0.2.0";

/** Version of the rules implementation (the engines). Bump it when a rule
 *  changes what a result says, so stored results can be recognised as stale. */
export const ENGINE_VERSION = "0.2.0";

const SEMVER = /^\d+\.\d+\.\d+$/;
export const SemVer = z.string().regex(SEMVER, "expected a version like 0.1.0");

/** The scraper's course id: three-letter prefix + four digits + an optional
 *  letter suffix (lab "l", combined "c"), lowercased, no space. "MAC 2311" is
 *  the display code; "mac2311" is the id every table joins on. */
export const CourseId = z
  .string()
  .regex(/^[a-z]{3}\d{4}[a-z]?$/, "expected a course id like mac2311 or chm2045l");
export type CourseId = z.infer<typeof CourseId>;

const COURSE_ID = /^[a-z]{3}\d{4}[a-z]?$/;

/** The one converter from any spelling of a UF course code to its id:
 *  "STA 3100", "STA3100", "cop 3502c", "COP3502C" -> "sta3100", "cop3502c".
 *  The suffix letter is part of the id ("chm2045" and "chm2045l" are
 *  different courses), so it is never dropped. Null when the text isn't a
 *  course code. Same rule as the scraper's ids.code_to_id. */
export function parseCourseId(code: string): CourseId | null {
  const id = code.replace(/\s+/g, "").toLowerCase();
  return COURSE_ID.test(id) ? id : null;
}

/** parseCourseId, throwing RangeError for text that isn't a course code. */
export function toCourseId(code: string): CourseId {
  const id = parseCourseId(code);
  if (id === null) throw new RangeError(`"${code}" is not a UF course code (expected e.g. "COP 3502C")`);
  return id;
}

/** "cop3502c" -> "COP 3502C", UF's display form. */
export function toDisplayCode(courseId: CourseId): string {
  return `${courseId.slice(0, 3)} ${courseId.slice(3)}`.toUpperCase();
}

/** "<college>-<program>", e.g. "uglas-gly_umn". Stable across catalog
 *  refreshes because it comes from UF's own page slug, not from row order. */
export const ProgramId = z
  .string()
  .regex(/^[a-z]+-[a-z0-9_]+$/, "expected a program id like uglas-gly_umn");
export type ProgramId = z.infer<typeof ProgramId>;

export const CatalogYear = z.string().regex(/^\d{4}-\d{4}$/, "expected a catalog year like 2026-2027");
export type CatalogYear = z.infer<typeof CatalogYear>;

/** ISO-8601 with an offset, as the scraper writes fetch times. */
export const Timestamp = z.iso.datetime({ offset: true });

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

export const Season = z.enum(["spring", "summer", "fall"]);
export type Season = z.infer<typeof Season>;

/** A UF term. An object rather than a string like "fall-2026" so nothing has
 *  to parse it, and rather than the SOC's numeric code ("2268") because that
 *  code is a UF implementation detail a person can't read. Summer sessions
 *  (A/B/C) are not modelled yet: a summer course is in "summer". */
export const Term = z.strictObject({
  season: Season,
  year: z.int().min(2000).max(2100),
});
export type Term = z.infer<typeof Term>;

const SEASON_ORDER: Record<Season, number> = { spring: 0, summer: 1, fall: 2 };

/** Calendar order: spring (January) < summer < fall (August) within a year.
 *  Negative when a is earlier, 0 when equal, positive when later. */
export function compareTerms(a: Term, b: Term): number {
  return a.year - b.year || SEASON_ORDER[a.season] - SEASON_ORDER[b.season];
}

/** The next fall or spring term: what "next semester" means when a caller
 *  gives no term (summer is opt-in, as at UF). */
export function nextRegularTerm(t: Term): Term {
  return t.season === "fall" ? { season: "spring", year: t.year + 1 } : { season: "fall", year: t.year };
}

const SEASON_MONTH: Record<Season, string> = { spring: "1", summer: "5", fall: "8" };

/** The Schedule of Courses' term code: "2" + two-digit year + start month
 *  (Spring 2027 = "2271"). The SOC files store terms this way. */
export function termCode(t: Term): string {
  return `2${String(t.year % 100).padStart(2, "0")}${SEASON_MONTH[t.season]}`;
}

export function termOfCode(code: string): Term {
  const m = /^2(\d\d)([158])$/.exec(code);
  if (!m) throw new RangeError(`"${code}" is not a Schedule of Courses term code`);
  const season = ({ "1": "spring", "5": "summer", "8": "fall" } as const)[m[2] as "1" | "5" | "8"];
  return { season, year: 2000 + Number(m[1]) };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const SourceKind = z.enum([
  "program_page", // catalog.ufl.edu program page (requirements, model plan, tracking)
  "course_catalog", // catalog.ufl.edu course listing (credits, prerequisites)
  "exam_credit_table", // catalog.ufl.edu exam-credit page
  "schedule_of_courses", // one.uf.edu SOC (offerings, sections)
  "university_policy", // a catalog policy page (grading, repeats, residency)
  "academic_record", // the student's own record entry
  "advisor_exception", // an approved substitution, waiver or overlap
]);
export type SourceKind = z.infer<typeof SourceKind>;

const NEEDS_URL: ReadonlySet<SourceKind> = new Set([
  "program_page",
  "course_catalog",
  "exam_credit_table",
  "schedule_of_courses",
  "university_policy",
]);

/** Where a fact came from, so the advisor can say "per the 2026-27 catalog
 *  page for the Geology minor" instead of asserting it. Catalog sources carry
 *  the URL and fetch time the scraper stored; a program page also carries the
 *  fingerprint of the requirement tables, which changes when UF edits them. */
export const SourceReference = z
  .strictObject({
    kind: SourceKind,
    /** Short human label: "Geology minor (catalog 2026-2027)". */
    label: z.string().min(1),
    url: z.url().optional(),
    catalogYear: CatalogYear.optional(),
    fetchedAt: Timestamp.optional(),
    fingerprint: z.string().optional(),
    /** The source's own words, when quoting them is the evidence. */
    excerpt: z.string().optional(),
    /** For record and exception sources: the id of the entry relied on. */
    entryId: z.string().optional(),
  })
  .superRefine((s, ctx) => {
    if (NEEDS_URL.has(s.kind) && !s.url)
      ctx.addIssue({ code: "custom", path: ["url"], message: `a ${s.kind} source needs its url` });
  });
export type SourceReference = z.infer<typeof SourceReference>;

/** Machine-readable reason codes. Every non-obvious status carries at least
 *  one, so a consumer can branch on `code` and show `message`. The meaning of
 *  each code is documented in lib/engines/README.md. */
export const ReasonCode = z.enum([
  // why something is unknown
  "program_needs_review",
  "rule_not_modeled",
  "missing_grade",
  "missing_input",
  "unknown_course",
  "requisite_unparsed",
  "requisite_unverifiable",
  // why something is not (yet) satisfied, or how it was satisfied
  "requirements_remaining",
  "in_progress_pending",
  "requisite_not_met",
  "count_rule_unmet",
  "counted_elsewhere",
  "waived",
  "substitution_applied",
  "overlap_allowed",
  "listed_twice",
  "gpa_below_minimum",
  // course filtering (requirement flags, candidate filter)
  "already_held",
  "not_offered",
  // plan validation
  "term_out_of_range",
  "duplicate_course",
  // planner
  "offering_unconfirmed",
  "credit_cap",
  "prerequisite_chain",
  "deadline_unreachable",
  "locked_conflict",
  // caveats: limits of what was checked at all
  "program_rules_not_captured",
  "grade_minimums_not_checked",
  "gpa_rule_not_checked",
]);
export type ReasonCode = z.infer<typeof ReasonCode>;

export const Reason = z.strictObject({
  code: ReasonCode,
  message: z.string().min(1),
  courseIds: z.array(CourseId).optional(),
  sources: z.array(SourceReference).optional(),
});
export type Reason = z.infer<typeof Reason>;

// ---------------------------------------------------------------------------
// Versions attached to every result
// ---------------------------------------------------------------------------

/** Which inputs produced a result. Two results with the same versions are
 *  comparable; when any of these change, a cached result is stale. */
export const ResultVersions = z.strictObject({
  contractVersion: SemVer,
  engineVersion: SemVer,
  /** Hash of the catalog data files the engine loaded (see catalog/load.ts). */
  dataVersion: z.string().regex(/^[0-9a-f]{16}$/),
  /** The catalog year the student is held to. */
  catalogYear: CatalogYear,
  recordId: z.string().min(1),
  recordVersion: z.string().min(1),
});
export type ResultVersions = z.infer<typeof ResultVersions>;
