/*
 * Mock /api/courses backed by course-fixture.json: 300 real UF courses with
 * real Fall 2026 / Spring 2027 sections and RMP matches (built by
 * tools/mock/build_course_fixture.py). The JSON is loaded on first use, so it
 * stays out of the main bundle.
 */

import type {
  ApiResult,
  CourseDetail,
  CourseSearchResult,
  CourseSummary,
  Delivery,
  GenEdArea,
  Instructor,
  ProfessorRating,
  Quest,
} from "@/lib/api/types"

type FixtureGroup = { instructors: string[]; sections: [string, string, string][] }
type FixtureCourse = {
  id: string
  code: string
  name: string
  credits: { min: number; max: number }
  description: string
  genEd: GenEdArea[]
  quest: Quest | null
  department: string
  departmentName: string
  level: number
  requisites: CourseDetail["requisites"]
  seasons: string[]
  sections: Record<string, FixtureGroup[]>
  sourceUrl: string
  fetchedAt: string
}
type Fixture = {
  terms: Record<string, string>
  courses: FixtureCourse[]
  ratings: Record<string, ProfessorRating | null>
}

/** The term that's next to register for. */
export const UPCOMING_TERM = "2271"
const CURRENT_TERM = "2268"
const PAGE_SIZE = 20
/** Below this, a rating is shown but not used to rank. Matches InstructorRating's "too few to rely on". */
const MIN_RATINGS = 5

let fixture: Promise<Fixture> | null = null
function load(): Promise<Fixture> {
  fixture ??= import("./course-fixture.json").then((m) => (m.default ?? m) as unknown as Fixture)
  return fixture
}

/** "cop 3530" / "COP3530" -> "cop3530". */
const compact = (s: string) => s.toLowerCase().replace(/\s+/g, "")

function instructor(f: Fixture, name: string): Instructor {
  return { name, rating: f.ratings[name] ?? null }
}

function reliableQuality(i: Instructor) {
  return i.rating && i.rating.quality != null && i.rating.numRatings >= MIN_RATINGS ? i.rating.quality : null
}

function summary(f: Fixture, c: FixtureCourse): CourseSummary {
  const upcoming = c.sections[UPCOMING_TERM] ?? []
  let best: CourseSummary["bestRating"] = null
  for (const g of upcoming)
    for (const name of g.instructors) {
      const q = reliableQuality(instructor(f, name))
      if (q != null && (!best || q > best.quality)) best = { quality: q, instructor: name }
    }
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    credits: c.credits,
    genEd: c.genEd,
    quest: c.quest,
    department: { slug: c.department, name: c.departmentName },
    level: c.level,
    offeredNextTerm: upcoming.length > 0,
    bestRating: best,
  }
}

export async function searchCourses(query: URLSearchParams): Promise<ApiResult<CourseSearchResult>> {
  const f = await load()
  const q = (query.get("q") ?? "").trim().toLowerCase()
  const words = q.split(/\s+/).filter(Boolean)
  const department = query.get("department")
  const level = Number(query.get("level")) || null
  const genEd = query.get("genEd")
  const credits = Number(query.get("credits")) || null
  const page = Math.max(1, Number(query.get("page")) || 1)

  const matches = f.courses.filter((c) => {
    if (q && !(c.id.includes(compact(q)) || words.every((w) => c.name.toLowerCase().includes(w)))) return false
    if (department && c.department !== department) return false
    if (level && c.level !== level) return false
    if (genEd && !(c.genEd.includes(genEd as GenEdArea) || c.quest === genEd)) return false
    if (credits && !(c.credits.min <= credits && credits <= c.credits.max)) return false
    return true
  })
  // Code matches first ("cop3530" before courses that only mention it), then by code.
  const codeHit = (c: FixtureCourse) => (q && c.id.startsWith(compact(q)) ? 0 : 1)
  matches.sort((a, b) => codeHit(a) - codeHit(b) || a.id.localeCompare(b.id))

  const departments = [...new Map(f.courses.map((c) => [c.department, c.departmentName]))]
    .map(([slug, name]) => ({ slug, name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    ok: true,
    data: {
      results: matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((c) => summary(f, c)),
      total: matches.length,
      page,
      pageSize: PAGE_SIZE,
      term: { code: UPCOMING_TERM, name: f.terms[UPCOMING_TERM] },
      departments,
    },
  }
}

export async function getCourse(id: string): Promise<ApiResult<CourseDetail>> {
  const f = await load()
  const c = f.courses.find((x) => x.id === compact(id))
  if (!c) return { ok: false, error: { code: "NOT_FOUND", message: `No course "${id}" in this preview's catalog.` } }

  const terms = [UPCOMING_TERM, CURRENT_TERM].map((code) => {
    const groups = (c.sections[code] ?? []).map((g) => ({
      // Best reliable rating first within a team-taught group; unrated last.
      instructors: g.instructors.map((n) => instructor(f, n)).sort((a, b) => (reliableQuality(b) ?? -1) - (reliableQuality(a) ?? -1)),
      sections: g.sections.map(([section, classNumber, delivery]) => ({ section, classNumber, delivery: delivery as Delivery })),
    }))
    // Best reliable rating first; groups with no reliable rating after, staff-only last.
    const rank = (g: (typeof groups)[number]) => Math.max(-1, ...g.instructors.map((i) => reliableQuality(i) ?? -1)) + (g.instructors.length ? 0 : -10)
    groups.sort((a, b) => rank(b) - rank(a))
    return { code, name: f.terms[code], groups }
  })

  return {
    ok: true,
    data: {
      ...summary(f, c),
      description: c.description,
      requisites: c.requisites,
      seasons: c.seasons,
      terms,
      source: { label: `UF Catalog: ${c.departmentName}`, url: c.sourceUrl, fetchedAt: c.fetchedAt },
    },
  }
}

/** Real section instructors for the mock schedule, so it matches /courses. */
export async function sectionInstructors(courseId: string, term: string, section: string): Promise<Instructor[]> {
  const f = await load()
  const g = f.courses.find((c) => c.id === courseId)?.sections[term]?.find((x) => x.sections.some(([s]) => s === section))
  return g ? g.instructors.map((n) => instructor(f, n)) : []
}
