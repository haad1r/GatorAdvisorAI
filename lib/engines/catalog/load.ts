import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "./csv";
import {
  Catalog,
  type Course,
  type ExamAward,
  type Milestone,
  type ModelPlanEntry,
  type Program,
  type Requisite,
  type RequirementGroup,
} from "../schemas";

/**
 * Builds the engine's Catalog from the scraper's CSVs.
 *
 * Split in two so the engine stays usable outside Node: `buildCatalog` is
 * pure (file text in, validated Catalog out) and `loadCatalog` is the only
 * part that touches the filesystem. When Maria's data layer lands, it
 * replaces `loadCatalog`, and everything downstream keeps receiving the same
 * validated Catalog.
 */

/** Every file the catalog is built from, in a fixed order (it feeds the hash). */
export const CATALOG_FILES = [
  "catalog/courses.csv",
  "catalog/requisites.csv",
  "soc/courses.csv",
  "soc/requisites.csv",
  "programs/programs.csv",
  "programs/requirements.csv",
  "programs/milestones.csv",
  "programs/plans.csv",
  "exam_credit/awards.csv",
] as const;
export type CatalogFile = (typeof CATALOG_FILES)[number];

export function loadCatalog(dataDir: string): Catalog {
  const files = Object.fromEntries(
    CATALOG_FILES.map((f) => [f, readFileSync(join(dataDir, f), "utf8")]),
  ) as Record<CatalogFile, string>;
  return buildCatalog(files);
}

/** sha256 over each file's name and text. The repo stores data/ with LF
 *  endings (.gitattributes), so the hash is the same on every OS. */
export function dataVersionOf(files: Record<CatalogFile, string>): string {
  const h = createHash("sha256");
  for (const f of CATALOG_FILES) h.update(f).update("\0").update(files[f]).update("\0");
  return h.digest("hex").slice(0, 16);
}

// --- cell readers: the CSVs write "" for absent, True/False for booleans ---

const text = (s: string): string | null => (s === "" ? null : s);
const num = (s: string): number | null => (s === "" ? null : Number(s));
const int = (s: string): number | null => (s === "" ? null : Number.parseInt(s, 10));
const bool = (s: string): boolean => s === "True";
const list = (s: string): string[] => (s === "" ? [] : s.split("|"));
const json = <T>(s: string, fallback: T): T => (s === "" ? fallback : (JSON.parse(s) as T));

/** Refuses a second row with the same key instead of letting it overwrite
 *  the first. A silent overwrite is how a refresh "creates duplicates" that
 *  nobody sees: one of the two rows just disappears. */
function putUnique<T>(map: Record<string, T>, key: string, value: T, what: string): void {
  if (Object.hasOwn(map, key)) throw new Error(`duplicate ${what} "${key}"`);
  map[key] = value;
}

function requisitesByCourse(rows: Record<string, string>[]): Map<string, Partial<Record<"prereq" | "coreq", Requisite>>> {
  const out = new Map<string, Partial<Record<"prereq" | "coreq", Requisite>>>();
  for (const r of rows) {
    const kind = r.kind as "prereq" | "coreq";
    const entry = out.get(r.course_id) ?? {};
    if (entry[kind]) throw new Error(`duplicate ${kind} for course "${r.course_id}"`);
    entry[kind] = {
      kind,
      status: r.status as Requisite["status"],
      tree: json(r.tree, null),
      rawText: r.raw_text,
    };
    out.set(r.course_id, entry);
  }
  return out;
}

export function buildCatalog(files: Record<CatalogFile, string>): Catalog {
  const rows = (f: CatalogFile) => parseCsv(files[f]);
  const courses: Record<string, Course> = {};

  // Catalog courses first; the SOC only fills ids the catalog lacks.
  const catalogReqs = requisitesByCourse(rows("catalog/requisites.csv"));
  let catalogYear = "";
  for (const r of rows("catalog/courses.csv")) {
    catalogYear ||= r.catalog_year;
    const req = catalogReqs.get(r.id) ?? {};
    putUnique(courses, r.id, {
      id: r.id,
      code: r.code,
      name: r.name,
      creditsMin: num(r.credits_min),
      creditsMax: num(r.credits_max),
      description: r.description,
      grading: text(r.grading) as Course["grading"],
      genEd: list(r.gen_ed),
      quest: text(r.quest),
      writingWords: int(r.writing_words),
      attributes: list(r.other_attributes),
      deptSlug: text(r.dept_slug),
      origin: "catalog",
      prerequisite: req.prereq ?? null,
      corequisite: req.coreq ?? null,
      source: {
        kind: "course_catalog",
        label: `${r.code} (catalog ${r.catalog_year})`,
        url: r.source_url,
        catalogYear: r.catalog_year,
        fetchedAt: r.fetched_at,
      },
    }, "course");
  }

  const socReqs = requisitesByCourse(rows("soc/requisites.csv"));
  const socSeen = new Set<string>();
  for (const r of rows("soc/courses.csv")) {
    if (socSeen.has(r.course_id)) throw new Error(`duplicate SOC course "${r.course_id}"`);
    socSeen.add(r.course_id);
    if (Object.hasOwn(courses, r.course_id)) continue;
    const req = socReqs.get(r.course_id) ?? {};
    courses[r.course_id] = {
      id: r.course_id,
      code: r.code,
      name: r.name,
      creditsMin: null,
      creditsMax: null,
      description: r.description,
      grading: null,
      genEd: [],
      quest: null,
      writingWords: null,
      attributes: [],
      deptSlug: null,
      origin: "schedule",
      prerequisite: req.prereq ?? null,
      corequisite: req.coreq ?? null,
      source: {
        kind: "schedule_of_courses",
        label: `${r.code} (Schedule of Courses)`,
        url: r.source_url,
        fetchedAt: r.fetched_at,
      },
    };
  }

  // Programs, then their groups / milestones / grid rows by program id.
  const programs: Record<string, Program> = {};
  for (const r of rows("programs/programs.csv")) {
    putUnique(programs, r.id, {
      id: r.id,
      name: r.name,
      kind: r.kind as Program["kind"],
      degree: text(r.degree),
      collegeSlug: r.college_slug,
      status: r.status as Program["status"],
      confidence: Number(r.confidence),
      catalogYear: r.catalog_year,
      overrideReason: text(r.override_reason),
      source: {
        kind: "program_page",
        label: `${r.name} (catalog ${r.catalog_year})`,
        url: r.source_url,
        catalogYear: r.catalog_year,
        fetchedAt: r.fetched_at,
        fingerprint: r.fingerprint,
      },
      requirements: [],
      milestones: [],
      modelPlan: [],
    }, "program");
  }
  const programOf = (id: string, file: string): Program => {
    const p = programs[id];
    if (!p) throw new Error(`${file} names unknown program "${id}"`);
    return p;
  };

  const groupKeys = new Set<string>();
  for (const r of rows("programs/requirements.csv")) {
    const group: RequirementGroup = {
      programId: r.program_id,
      key: r.group_key,
      name: r.name,
      ruleType: r.rtype as RequirementGroup["ruleType"],
      section: r.section as RequirementGroup["section"],
      logic: json(r.logic, {}),
      eligibleCourseIds: json(r.eligible_course_ids, []),
      requiredCredits: num(r.required_credits),
      requiredCourseCount: int(r.required_course_count),
      sortOrder: Number.parseInt(r.sort_order, 10),
    };
    const identity = `${group.programId}/${group.key}`;
    if (groupKeys.has(identity)) throw new Error(`duplicate requirement "${identity}"`);
    groupKeys.add(identity);
    programOf(r.program_id, "requirements.csv").requirements.push(group);
  }
  for (const r of rows("programs/milestones.csv")) {
    const m: Milestone = {
      semester: Number.parseInt(r.semester, 10),
      kind: r.kind as Milestone["kind"],
      slots: json(r.slots, []),
      count: int(r.count),
      pool: json(r.pool, []),
      rawText: r.raw_text,
      minGrade: (text(r.min_grade) as Milestone["minGrade"]) ?? null,
      gpaMin: r.gpa_min ? Number(r.gpa_min) : null,
      gpaScope: (text(r.gpa_scope) as Milestone["gpaScope"]) ?? null,
    };
    programOf(r.program_id, "milestones.csv").milestones.push(m);
  }
  for (const r of rows("programs/plans.csv")) {
    const e: ModelPlanEntry = {
      semesterIndex: Number.parseInt(r.semester_index, 10),
      position: Number.parseInt(r.position, 10),
      courseId: text(r.course_id),
      placeholder: text(r.placeholder),
      credits: num(r.credits),
      isCriticalTracking: bool(r.is_critical_tracking),
      isSummer: bool(r.is_summer),
      altGroup: int(r.alt_group),
      altOption: int(r.alt_option),
    };
    programOf(r.program_id, "plans.csv").modelPlan.push(e);
  }
  // Array.prototype.sort is stable, so equal sortOrders keep file order.
  for (const p of Object.values(programs)) p.requirements.sort((a, b) => a.sortOrder - b.sortOrder);

  const examAwards: Record<string, ExamAward> = {};
  for (const r of rows("exam_credit/awards.csv")) {
    putUnique(examAwards, r.id, {
      id: r.id,
      family: r.family,
      exam: r.exam,
      minScore: Number(r.min_score),
      maxScore: Number(r.max_score),
      scoreLabel: text(r.score_label),
      courseIds: list(r.course_ids),
      credits: Number(r.credits),
      creditsSource: r.credits_source as ExamAward["creditsSource"],
      genEd: list(r.gen_ed),
      writingWords: int(r.writing_words),
      awardText: r.award_text,
      source: {
        kind: "exam_credit_table",
        label: `${r.family} ${r.exam} (catalog ${r.catalog_year})`,
        url: r.source_url,
        catalogYear: r.catalog_year,
        fetchedAt: r.fetched_at,
      },
    }, "exam award");
  }

  // One validation pass over everything assembled above. The casts in this
  // file (`as Program["kind"]`, ...) are checked here, not trusted.
  return Catalog.parse({
    dataVersion: dataVersionOf(files),
    catalogYear,
    courses,
    programs,
    examAwards,
  });
}
