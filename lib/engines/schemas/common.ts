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
export const CONTRACT_VERSION = "0.1.0";

const SEMVER = /^\d+\.\d+\.\d+$/;
export const SemVer = z.string().regex(SEMVER, "expected a version like 0.1.0");

/** The scraper's course id: three-letter prefix + four digits + an optional
 *  letter suffix (lab "l", combined "c"), lowercased, no space. "MAC 2311" is
 *  the display code; "mac2311" is the id every table joins on. */
export const CourseId = z
  .string()
  .regex(/^[a-z]{3}\d{4}[a-z]?$/, "expected a course id like mac2311 or chm2045l");
export type CourseId = z.infer<typeof CourseId>;

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
  // planner
  "offering_unconfirmed",
  "credit_cap",
  "prerequisite_chain",
  "deadline_unreachable",
  "locked_conflict",
  // caveats: limits of what was checked at all
  "program_rules_not_captured",
  "grade_minimums_not_checked",
  "gpa_rule_not_captured",
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
