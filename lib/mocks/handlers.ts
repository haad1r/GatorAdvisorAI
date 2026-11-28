import type {
  ApiError,
  ApiResult,
  Coursework,
  Profile,
  SurveySubmission,
} from "@/lib/api/types"
import { hasErrors, type FieldErrors } from "@/lib/forms"
import { emptyProfile, validateProfile } from "@/lib/onboarding"
import { validateSurvey } from "@/lib/survey"
import {
  courseworkFixture,
  examFixture,
  examWeekStart,
  freshnessFixture,
  profileFixture,
  surveyFixture,
  termFor,
  weeklyMeetingsFixture,
} from "./fixtures"
import { auditFixture, trackingFixture } from "./audit-fixtures"

type Store = {
  profile: Profile
  coursework: Coursework
  survey: SurveySubmission | null
}

let store: Store = freshStore()

function freshStore(): Store {
  return structuredClone({
    profile: profileFixture,
    coursework: courseworkFixture,
    survey: surveyFixture,
  })
}

export function resetMockStore() {
  store = freshStore()
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data: structuredClone(data) }
}

function fail(error: ApiError): ApiResult<never> {
  return { ok: false, error }
}

function invalid(fieldErrors: FieldErrors): ApiResult<never> {
  return fail({
    code: "VALIDATION_ERROR",
    message: "Some fields need fixing.",
    fieldErrors,
  })
}

const COURSE_CODE = /^[A-Z]{3}\d{4}[A-Z]?$/

function validateCoursework(body: Coursework): FieldErrors {
  const errors: FieldErrors = {}
  body.rows.forEach((row, i) => {
    const add = (field: string, msg: string) =>
      (errors[`rows.${i}.${field}`] ??= []).push(msg)
    if (!COURSE_CODE.test(row.courseCode))
      add("courseCode", "Use the course code without spaces, like COP3502.")
    if (!row.grade.trim()) add("grade", "Enter a grade.")
    if (!(row.credits > 0)) add("credits", "Credits must be more than 0.")
    if (!row.term.trim()) add("term", "Enter a term.")
  })
  return errors
}

type Handler = (body: unknown, query: URLSearchParams) => ApiResult<unknown>

export const routes: Record<string, Handler> = {
  "GET /api/meta/freshness": () => ok(freshnessFixture),

  "GET /api/schedule": (_body, query) => {
    const week = query.get("week") ?? ""
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
      return { ok: false, error: { code: "VALIDATION_ERROR", message: "week must be a YYYY-MM-DD Monday." } }
    }
    const meetings = week === examWeekStart ? [...weeklyMeetingsFixture, examFixture] : weeklyMeetingsFixture
    return ok({ term: termFor(week), weekStart: week, meetings })
  },

  /* Fixed results: they don't recompute when profile or courses change. */
  "GET /api/audit": () => ok({ ...auditFixture, recordVersion: store.coursework.version }),
  "GET /api/tracking": () => ok(trackingFixture),

  "GET /api/profile": () => ok(store.profile),

  "PUT /api/profile": (body) => {
    const profile = body as Profile
    const errors = validateProfile(profile)
    if (hasErrors(errors)) return invalid(errors)
    store.profile = structuredClone(profile)
    return ok(store.profile)
  },

  "GET /api/survey": () => ok(store.survey),

  "POST /api/survey": (body) => {
    // Same check the real endpoint will run (lib/survey.ts).
    const errors = validateSurvey(body)
    if (hasErrors(errors)) return invalid(errors)
    store.survey = structuredClone(body as SurveySubmission)
    return ok(store.survey)
  },

  "DELETE /api/account": () => {
    store = {
      profile: structuredClone(emptyProfile),
      coursework: { version: store.coursework.version + 1, rows: [] },
      survey: null,
    }
    return ok(null)
  },

  "GET /api/coursework": () => ok(store.coursework),

  "PUT /api/coursework": (body) => {
    const next = body as Coursework
    if (next.version !== store.coursework.version) {
      return fail({
        code: "STALE_WRITE",
        message: "Your courses were changed somewhere else. Reload to see the latest before saving.",
      })
    }
    const errors = validateCoursework(next)
    if (hasErrors(errors)) return invalid(errors)
    store.coursework = { version: next.version + 1, rows: structuredClone(next.rows) }
    return ok(store.coursework)
  },
}
