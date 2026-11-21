/*
 * PROVISIONAL: shapes taken from issues #12 and #19 until Maria's
 * api-contracts.md exists. Replace this file when it does.
 */

import type { FieldErrors } from "@/lib/forms"
import type { OnboardingProfile } from "@/lib/onboarding"

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError }

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "STALE_WRITE"
  | "QUOTA_EXCEEDED"
  | "SERVER"
  | "NETWORK"

export type ApiError = {
  code: ApiErrorCode
  message: string
  fieldErrors?: FieldErrors
  retryAfterSeconds?: number
}

export type Profile = OnboardingProfile

export type SurveyQuestionId =
  | "interests"
  | "lower_interest_topics"
  | "major_scope"
  | "course_level"
  | "requirement_progress"
  | "exploration_mode"

export type SurveyAnswerStatus = "answered" | "skipped" | "hidden"

export type SurveyAnswer = {
  questionId: SurveyQuestionId
  status: SurveyAnswerStatus
  /** null when skipped or hidden, never an empty answer. */
  value: string[] | string | null
}

export type SurveySubmission = {
  surveyVersion: "survey_v1"
  interestListVersion: "interests_v1"
  submittedAt: string
  answers: SurveyAnswer[]
}

export type CourseworkStatus = "confirmed" | "needs-review"

export type CourseworkSource = "transcript" | "manual" | "exam"

export type CourseworkRow = {
  id: string
  courseCode: string
  grade: string
  credits: number
  term: string
  source: CourseworkSource
  status: CourseworkStatus
}

export type Coursework = {
  /** Saving with an old version returns STALE_WRITE. */
  version: number
  rows: CourseworkRow[]
}

export type Weekday = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN"

export type MeetingKind = "lecture" | "lab" | "discussion" | "exam"

/**
 * RateMyProfessors summary numbers for one professor. null when RMP has no
 * value. Comes from tools/rmp (a weekly import); never review text.
 */
export type ProfessorRating = {
  /** RMP's professor id: ratemyprofessors.com/professor/<rmpId>. */
  rmpId: number
  /** 1-5. */
  quality: number | null
  /** 1-5. */
  difficulty: number | null
  /** 0-100. */
  wouldTakeAgainPercent: number | null
  numRatings: number
}

export type Instructor = {
  name: string
  /** null when no RMP profile could be matched with confidence. */
  rating: ProfessorRating | null
}

/** One weekly class meeting (or a dated exam) for the schedule calendar. */
export type ScheduleMeeting = {
  id: string
  courseCode: string
  title: string
  section: string
  kind: MeetingKind
  /**
   * Local America/New_York wall-clock time ("HH:MM", 24h). null when the
   * meeting is TBA or asynchronous: it is listed, never given an invented time.
   */
  time: { day: Weekday; start: string; end: string } | null
  /** null when TBA or online. */
  location: string | null
  online: boolean
  /** Empty when UF hasn't named one yet ("Staff"). Same for every meeting of a section. */
  instructors: Instructor[]
}

export type WeekSchedule = {
  term: string
  /** Monday of the week, "YYYY-MM-DD". */
  weekStart: string
  meetings: ScheduleMeeting[]
}

/*
 * Degree audit and Critical Tracking. PROVISIONAL: taken from the engine plan
 * in issue #8 ("The 5 answers", 1 and 4). Shaun's engine owns these shapes;
 * confirm or replace them when it publishes its own.
 */

/** #8: every answer is one of these. Missing data or rules give "unknown", never a guess. */
export type AuditStatus = "met" | "in_progress" | "not_met" | "unknown"

export type RequirementCategory = "major" | "gen_ed" | "minor"

/** Where a rule came from: catalog page and when it was read. */
export type SourceReference = {
  label: string
  url: string
  /** ISO timestamp. */
  fetchedAt: string
}

export type CountedCourse = {
  courseCode: string
  /** null while the course is in progress. */
  grade: string | null
  credits: number
  term: string
  source: "transcript" | "manual" | "exam" | "transfer"
  inProgress: boolean
}

export type RequirementResult = {
  id: string
  category: RequirementCategory
  title: string
  status: AuditStatus
  /** null when the requirement isn't measured that way. */
  needed: { credits: number | null; courses: number | null }
  earned: { credits: number; courses: number }
  counted: CountedCourse[]
  /** What would finish it, as UF words it ("COT 3100", "One of ENC 3246, ENC 2210"). */
  stillToTake: string[]
  /** One short sentence. */
  reason: string
  sources: SourceReference[]
}

export type GpaKind = "overall" | "major" | "upper_division"

export type GpaResult = {
  kind: GpaKind
  /** null when there is nothing to average yet, or the rule is unknown. */
  value: number | null
  note?: string
}

export type DegreeAudit = {
  program: { id: string; name: string; catalogYear: string }
  /** Coursework version the audit was run against. */
  recordVersion: number
  generatedAt: string
  credits: { earned: number; inProgress: number; required: number; remaining: number }
  /** Earned credits toward the degree, 0-100. From the engine, not computed by the UI (#21). */
  percentComplete: number
  gpa: GpaResult[]
  requirements: RequirementResult[]
  /** Courses counting toward more than one requirement. */
  sharedCourses: { courseCode: string; requirementIds: string[] }[]
  /** Everything the engine couldn't decide. */
  unknowns: { requirementId: string | null; message: string }[]
}

/** #8 answer 4. */
export type TrackingStatus = "met" | "at_risk" | "not_met" | "unknown"

export type TrackingMilestone = {
  id: string
  /** Semester number in the program's tracking plan (1 = first). */
  semester: number
  description: string
  /** The term this must be done by, for this student ("Spring 2027"). */
  deadlineTerm: string
  status: TrackingStatus
  reason: string
  sources: SourceReference[]
}

export type TrackingResult = {
  milestones: TrackingMilestone[]
  /** The earliest milestone that isn't met yet, or null. */
  nextDeadline: TrackingMilestone | null
}

/** Shown in the app footer so students know how current the data is. */
export type DataFreshness = {
  catalogYear: string
  /** ISO timestamp of the last schedule (SOC) data refresh. */
  scheduleUpdatedAt: string
}

export type ApiRequest = {
  method: "GET" | "POST" | "PUT" | "DELETE"
  path: string
  body?: unknown
}

export type Transport = (request: ApiRequest) => Promise<ApiResult<unknown>>
