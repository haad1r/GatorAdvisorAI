import type { FieldErrors } from "@/lib/forms"
import type { Option } from "@/lib/onboarding"
import type { SurveyAnswer, SurveyQuestionId, SurveySubmission } from "@/lib/api/types"

/*
 * Interest survey (#19 part A). Questions, IDs and option values come from
 * docs/recommendations/survey.md (survey_v1) and the interest list from
 * docs/recommendations/interest-list.md (interests_v1). IDs and values are
 * stable and stored; display text can be reworded freely.
 *
 * Pure module: no React, no I/O, so the API route can reuse validateSurvey().
 */

export const SURVEY_VERSION = "survey_v1" as const
export const INTEREST_LIST_VERSION = "interests_v1" as const

export type InterestGroup = { id: string; label: string; interests: Option[] }

/** The 22 interests in their 6 display groups. Groups are layout only, never scored. */
export const INTEREST_GROUPS: InterestGroup[] = [
  {
    id: "technology_engineering",
    label: "Technology & Engineering",
    interests: [
      { value: "programming_software", label: "Programming & Software" },
      { value: "ai_data", label: "AI & Data Science" },
      { value: "engineering_design", label: "Engineering & Building Things" },
      { value: "construction_planning", label: "Construction, Cities & Planning" },
    ],
  },
  {
    id: "science_math",
    label: "Science & Math",
    interests: [
      { value: "math_physical_sciences", label: "Math & Physical Sciences" },
      { value: "life_sciences", label: "Biology & Life Sciences" },
      { value: "environment_agriculture", label: "Environment, Agriculture & Food" },
      { value: "animals_wildlife", label: "Animals & Wildlife" },
    ],
  },
  {
    id: "health",
    label: "Health",
    interests: [
      { value: "health_medicine", label: "Health & Medicine" },
      { value: "sports_fitness", label: "Sports, Fitness & Movement" },
    ],
  },
  {
    id: "business",
    label: "Business",
    interests: [
      { value: "business_management", label: "Business, Marketing & Entrepreneurship" },
      { value: "finance_accounting", label: "Finance, Accounting & Economics" },
    ],
  },
  {
    id: "arts_media",
    label: "Arts & Media",
    interests: [
      { value: "media_communication", label: "Media, Journalism & Communication" },
      { value: "visual_arts_design", label: "Art, Design & Architecture" },
      { value: "performing_arts_music", label: "Music, Theater & Dance" },
      { value: "writing_literature", label: "Writing & Literature" },
    ],
  },
  {
    id: "society_humanities",
    label: "Society & Humanities",
    interests: [
      { value: "languages_global", label: "Languages & Global Studies" },
      { value: "history_culture_philosophy", label: "History, Philosophy & Religion" },
      { value: "politics_law", label: "Politics & Law" },
      { value: "society_social_sciences", label: "Society & Social Sciences" },
      { value: "psychology_behavior", label: "Psychology & Human Behavior" },
      { value: "education_teaching", label: "Education & Teaching" },
    ],
  },
]

export const INTEREST_IDS: string[] = INTEREST_GROUPS.flatMap((g) => g.interests.map((i) => i.value))

export function interestLabel(id: string) {
  for (const group of INTEREST_GROUPS) {
    const found = group.interests.find((i) => i.value === id)
    if (found) return found.label
  }
  return id
}

export type SurveyQuestion =
  | {
      id: SurveyQuestionId
      text: string
      /** Short name for the error summary and review lists. */
      short: string
      help?: string
      type: "multi_choice"
    }
  | {
      id: SurveyQuestionId
      text: string
      short: string
      help?: string
      type: "single_choice"
      options: Option[]
    }

/** In display order. Every question is optional and a preference, never a hard filter. */
export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: "interests",
    text: "Which topics are you most interested in?",
    short: "Interests",
    help: "Pick as many as you like.",
    type: "multi_choice",
  },
  {
    id: "lower_interest_topics",
    text: "Which topics interest you less?",
    short: "Less interested",
    help: "We'll rank these lower. They're never hidden from you.",
    type: "multi_choice",
  },
  {
    id: "major_scope",
    text: "Do you want suggestions mostly inside your major, or outside it?",
    short: "Inside or outside your major",
    type: "single_choice",
    options: [
      { value: "inside_major", label: "Mostly inside my major" },
      { value: "mix", label: "A mix" },
      { value: "outside_major", label: "Mostly outside my major" },
    ],
  },
  {
    id: "course_level",
    text: "What course level do you want right now?",
    short: "Course level",
    type: "single_choice",
    options: [
      { value: "intro", label: "Intro (1000-2000 level)" },
      { value: "advanced", label: "Advanced (3000-4000 level)" },
      { value: "no_preference", label: "No preference" },
    ],
  },
  {
    id: "requirement_progress",
    text: "Should we favor courses that also count toward Gen Ed or degree requirements?",
    short: "Favor requirements",
    type: "single_choice",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no_preference", label: "No preference" },
    ],
  },
  {
    id: "exploration_mode",
    text: "Are you still exploring?",
    short: "Still exploring",
    help: "If you are, we'll spread suggestions across more of your interests.",
    type: "single_choice",
    options: [
      { value: "exploring", label: "Yes, still exploring" },
      { value: "settled", label: "No, I know what I want" },
    ],
  },
]

export const QUESTION_IDS: SurveyQuestionId[] = SURVEY_QUESTIONS.map((q) => q.id)

/** Question id -> short label, for FormErrorSummary links. */
export const SURVEY_LABELS: Record<string, string> = Object.fromEntries(
  SURVEY_QUESTIONS.map((q) => [q.id, q.short])
)

export const UNDECLARED = "undeclared"

/** Q3 is hidden when the major is undeclared: there's no major to be inside of. */
export function isHidden(id: SurveyQuestionId, major: string) {
  return id === "major_scope" && major === UNDECLARED
}

/** What the student has picked so far. Missing or empty = not answered. */
export type SurveyDraft = Partial<Record<SurveyQuestionId, string | string[]>>

/**
 * Starting answers: the last submission's answered values (for a retake), or,
 * with none, Q6 starts at "exploring" for undeclared students.
 */
export function initialDraft(last: SurveySubmission | null, major: string): SurveyDraft {
  const draft: SurveyDraft = {}
  if (last) {
    for (const a of last.answers) {
      if (a.status === "answered" && a.value !== null && !isHidden(a.questionId, major)) {
        draft[a.questionId] = Array.isArray(a.value) ? [...a.value] : a.value
      }
    }
    return draft
  }
  if (major === UNDECLARED) draft.exploration_mode = "exploring"
  return draft
}

function isEmpty(value: SurveyAnswer["value"] | undefined) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)
}

/**
 * Always all six answers, in order: hidden by logic -> "hidden", nothing picked
 * -> "skipped", both with value null. Never an empty answer.
 */
export function toSubmission(draft: SurveyDraft, major: string, now = new Date()): SurveySubmission {
  return {
    surveyVersion: SURVEY_VERSION,
    interestListVersion: INTEREST_LIST_VERSION,
    submittedAt: now.toISOString(),
    answers: SURVEY_QUESTIONS.map((q): SurveyAnswer => {
      if (isHidden(q.id, major)) return { questionId: q.id, status: "hidden", value: null }
      const value = draft[q.id]
      if (isEmpty(value)) return { questionId: q.id, status: "skipped", value: null }
      return { questionId: q.id, status: "answered", value: Array.isArray(value) ? [...value] : value! }
    }),
  }
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

/**
 * Server-safe check of a submission. Field errors are keyed by question id so
 * they land on the matching question; problems with the envelope go under
 * "survey". Mirrors the draft zod schema in #36 (all six questions required).
 */
export function validateSurvey(body: unknown): FieldErrors {
  const errors: FieldErrors = {}
  const add = (key: string, msg: string) => (errors[key] ??= []).push(msg)

  if (!body || typeof body !== "object") {
    add("survey", "Send the survey as JSON.")
    return errors
  }
  const s = body as Partial<SurveySubmission>
  if (s.surveyVersion !== SURVEY_VERSION) add("survey", `Unknown survey version. Expected ${SURVEY_VERSION}.`)
  if (s.interestListVersion !== INTEREST_LIST_VERSION)
    add("survey", `Unknown interest list version. Expected ${INTEREST_LIST_VERSION}.`)
  if (typeof s.submittedAt !== "string" || !ISO_DATETIME.test(s.submittedAt) || Number.isNaN(Date.parse(s.submittedAt)))
    add("survey", "submittedAt must be an ISO date and time.")
  if (!Array.isArray(s.answers)) {
    add("survey", "answers must be a list.")
    return errors
  }

  const seen = new Set<string>()
  for (const raw of s.answers as unknown[]) {
    const a = (raw ?? {}) as Partial<SurveyAnswer>
    const id = String(a.questionId)
    const question = SURVEY_QUESTIONS.find((q) => q.id === a.questionId)
    if (!question) {
      add("survey", `Unknown question: ${id}.`)
      continue
    }
    if (seen.has(id)) add(id, "This question was answered twice.")
    seen.add(id)

    if (a.status === "skipped" || a.status === "hidden") {
      if (a.value !== null) add(id, "Skipped and hidden answers can't have a value.")
      continue
    }
    if (a.status !== "answered") {
      add(id, "Unknown answer status.")
      continue
    }
    if (isEmpty(a.value)) {
      add(id, "Pick an answer or skip this question.")
      continue
    }
    if (question.type === "multi_choice") {
      const v = a.value
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !INTEREST_IDS.includes(x)))
        add(id, "Pick topics from the list.")
      else if (new Set(v).size !== v.length) add(id, "Each topic can only be picked once.")
    } else if (typeof a.value !== "string" || !question.options.some((o) => o.value === a.value)) {
      add(id, "Pick one of the options.")
    }
  }
  for (const id of QUESTION_IDS) if (!seen.has(id)) add(id, "This question is missing from the submission.")

  const answered = (id: SurveyQuestionId) => {
    const a = (s.answers as SurveyAnswer[]).find((x) => x?.questionId === id)
    return a?.status === "answered" && Array.isArray(a.value) ? a.value : []
  }
  const both = answered("interests").filter((x) => answered("lower_interest_topics").includes(x))
  if (both.length)
    add("lower_interest_topics", `A topic can't be in both lists: ${both.map(interestLabel).join(", ")}.`)

  return errors
}
