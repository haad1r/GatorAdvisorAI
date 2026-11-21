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

export type CourseworkSource = "transcript" | "manual"

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
}

export type WeekSchedule = {
  term: string
  /** Monday of the week, "YYYY-MM-DD". */
  weekStart: string
  meetings: ScheduleMeeting[]
}

/** Shown in the app footer so students know how current the data is. */
export type DataFreshness = {
  catalogYear: string
  /** ISO timestamp of the last schedule (SOC) data refresh. */
  scheduleUpdatedAt: string
}

export type ApiRequest = {
  method: "GET" | "POST" | "PUT"
  path: string
  body?: unknown
}

export type Transport = (request: ApiRequest) => Promise<ApiResult<unknown>>
