import type {
  ApiError,
  ApiResult,
  Coursework,
  Profile,
  SurveyAnswer,
  SurveyQuestionId,
  SurveySubmission,
} from "@/lib/api/types"
import { hasErrors, type FieldErrors } from "@/lib/forms"
import { validateProfile } from "@/lib/onboarding"
import { courseworkFixture, freshnessFixture, profileFixture, surveyFixture } from "./fixtures"

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

const QUESTION_IDS: SurveyQuestionId[] = [
  "interests",
  "lower_interest_topics",
  "major_scope",
  "course_level",
  "requirement_progress",
  "exploration_mode",
]

function isEmpty(value: SurveyAnswer["value"]) {
  return value === null || value === "" || (Array.isArray(value) && value.length === 0)
}

function validateSurvey(body: SurveySubmission): FieldErrors {
  const errors: FieldErrors = {}
  const add = (id: string, msg: string) => (errors[id] ??= []).push(msg)

  for (const answer of body.answers) {
    if (!QUESTION_IDS.includes(answer.questionId)) {
      add(answer.questionId, "Unknown question.")
    } else if (answer.status === "answered" && isEmpty(answer.value)) {
      add(answer.questionId, "Pick an answer or skip this question.")
    } else if (answer.status !== "answered" && answer.value !== null) {
      add(answer.questionId, "Skipped and hidden answers can't have a value.")
    }
  }

  const liked = body.answers.find((a) => a.questionId === "interests")?.value
  const disliked = body.answers.find((a) => a.questionId === "lower_interest_topics")?.value
  if (Array.isArray(liked) && Array.isArray(disliked)) {
    if (disliked.some((id) => liked.includes(id)))
      add("lower_interest_topics", "An interest can't be in both lists.")
  }

  return errors
}

type Handler = (body: unknown) => ApiResult<unknown>

export const routes: Record<string, Handler> = {
  "GET /api/meta/freshness": () => ok(freshnessFixture),

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
    const submission = body as SurveySubmission
    const errors = validateSurvey(submission)
    if (hasErrors(errors)) return invalid(errors)
    store.survey = structuredClone(submission)
    return ok(store.survey)
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
