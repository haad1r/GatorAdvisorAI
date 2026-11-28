import { createHash } from "node:crypto"
import { CONTRACT_VERSION, compareTerms, toCourseId, type Season, type Term } from "../engines/schemas/common"
import { AcademicRecord, type CourseAttempt, type ElectiveCredit, type ExamCredit } from "../engines/schemas/record"

/*
 * Database rows → the engine's AcademicRecord (lib/engines/schemas/record.ts).
 * The result is validated with the engine's own schema, so if our tables and
 * Shaun's contract ever drift apart this throws instead of feeding the engine
 * a record it would misread.
 */

export type ProfileRow = { program_id: string; catalog_year: string; entry_term: string }

export type RecordRow = { version: number; has_florida_aa: boolean | null; language_proficiency: boolean | null }

export type AttemptRow = {
  id: string
  course_code: string
  grade: string | null
  credits: number | string
  term: string | null
  source: "uf" | "transfer" | "dual_enrollment"
  institution: string | null
  status: "completed" | "in_progress"
  original_label: string | null
}

export type ExamCreditRow = { id: string; award_id: string; score: number | string; course_codes: string[]; credits: number | string }

export type ElectiveCreditRow = {
  id: string
  label: string
  credits: number | string
  source: "transfer" | "dual_enrollment" | "exam"
  institution: string | null
}

export type RecordInput = {
  userId: string
  profile: ProfileRow
  /** null when the student has never saved courses: version 0, nothing known. */
  record: RecordRow | null
  attempts: AttemptRow[]
  examCredits: ExamCreditRow[]
  electiveCredits: ElectiveCreditRow[]
  now?: Date
}

const SEASONS: Record<string, Season> = { spring: "spring", summer: "summer", fall: "fall" }

/** "Fall 2025" → { season: "fall", year: 2025 }. */
export function parseTerm(text: string): Term {
  const m = /^(spring|summer|fall)\s+(\d{4})$/i.exec(text.trim())
  if (!m) throw new RangeError(`"${text}" is not a term like "Fall 2025"`)
  return { season: SEASONS[m[1].toLowerCase()], year: Number(m[2]) }
}

function calendarTerm(date: Date): Term {
  const month = date.getMonth()
  const season: Season = month < 4 ? "spring" : month < 7 ? "summer" : "fall"
  return { season, year: date.getFullYear() }
}

function termAfter(t: Term): Term {
  if (t.season === "spring") return { season: "summer", year: t.year }
  if (t.season === "summer") return { season: "fall", year: t.year }
  return { season: "spring", year: t.year + 1 }
}

/**
 * The engine never reads the clock, so "now" is decided here: the term the
 * student is enrolled in when they have in-progress courses, otherwise the
 * calendar term, moved past any term the student has already completed (a
 * fall course finished in December is completed while the calendar still
 * says fall).
 */
export function currentTermFor(attempts: { status: string; term?: Term }[], now: Date): Term {
  const inProgress = attempts.find((a) => a.status === "in_progress" && a.term)?.term
  if (inProgress) return inProgress

  let current = calendarTerm(now)
  for (const a of attempts) {
    if (a.status === "completed" && a.term && compareTerms(a.term, current) >= 0) current = termAfter(a.term)
  }
  return current
}

function opaqueId(userId: string) {
  return createHash("sha256").update(`gatoradvisor-record:${userId}`).digest("hex").slice(0, 24)
}

export function toAcademicRecord(input: RecordInput): AcademicRecord {
  const attempts: CourseAttempt[] = input.attempts.map((row) => ({
    attemptId: row.id,
    courseId: toCourseId(row.course_code),
    status: row.status,
    ...(row.grade !== null && { grade: row.grade as CourseAttempt["grade"] }),
    credits: Number(row.credits),
    source: row.source,
    ...(row.term !== null && { term: parseTerm(row.term) }),
    ...(row.institution !== null && { institution: row.institution }),
    ...(row.source !== "uf" && row.original_label !== null && { originalCode: row.original_label }),
  }))

  const examCredits: ExamCredit[] = input.examCredits.map((row) => ({
    examCreditId: row.id,
    awardId: row.award_id,
    score: Number(row.score),
    courseIds: row.course_codes.map(toCourseId),
    credits: Number(row.credits),
  }))

  const electiveCredits: ElectiveCredit[] = input.electiveCredits.map((row) => ({
    entryId: row.id,
    label: row.label,
    credits: Number(row.credits),
    source: row.source,
    ...(row.institution !== null && { institution: row.institution }),
  }))

  const record = input.record
  return AcademicRecord.parse({
    contractVersion: CONTRACT_VERSION,
    recordId: opaqueId(input.userId),
    recordVersion: String(record?.version ?? 0),
    catalogYear: input.profile.catalog_year,
    currentTerm: currentTermFor(attempts, input.now ?? new Date()),
    firstTerm: parseTerm(input.profile.entry_term),
    programs: [{ programId: input.profile.program_id }],
    attempts,
    examCredits,
    electiveCredits,
    // Advisor exceptions aren't stored until there's a verified source (docs/database.md).
    exceptions: [],
    facts: {
      ...(record?.has_florida_aa != null && { hasFloridaAA: record.has_florida_aa }),
      ...(record?.language_proficiency != null && { languageProficiency: record.language_proficiency }),
    },
  })
}
