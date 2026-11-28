import { z } from "zod"
import type { Survey, Tag } from "./scoring"

// Versioned, pure input contracts for synthetic preparation. No persistence or
// live recommendation integration; coordinate the API contract with its owners.
export const interestIds = [
  "programming_software", "ai_data", "engineering_design", "construction_planning",
  "math_physical_sciences", "life_sciences", "environment_agriculture", "animals_wildlife",
  "health_medicine", "sports_fitness", "business_management", "finance_accounting",
  "media_communication", "visual_arts_design", "performing_arts_music", "writing_literature",
  "languages_global", "history_culture_philosophy", "politics_law", "society_social_sciences",
  "psychology_behavior", "education_teaching",
] as const
const Interest = z.enum(interestIds)
const ids = ["interests", "lower_interest_topics", "major_scope", "course_level", "requirement_progress", "exploration_mode"] as const
const Question = z.enum(ids)
const Answer = z.strictObject({ questionId: Question, status: z.enum(["answered", "skipped", "hidden"]), value: z.union([z.string(), z.array(z.string()), z.null()]) })
const choices: Record<string, readonly string[]> = {
  major_scope: ["inside_major", "mix", "outside_major"],
  course_level: ["intro", "advanced", "no_preference"],
  requirement_progress: ["yes", "no_preference"],
  exploration_mode: ["exploring", "settled"],
}

export const SurveySubmissionSchema = z.strictObject({
  surveyVersion: z.literal("survey_v1"),
  interestListVersion: z.literal("interests_v1"),
  submittedAt: z.iso.datetime({ offset: true }),
  answers: z.array(Answer),
}).superRefine((submission, ctx) => {
  const seen = new Set<string>()
  for (const [index, answer] of submission.answers.entries()) {
    const issue = (message: string) => ctx.addIssue({ code: "custom", path: ["answers", index], message })
    if (seen.has(answer.questionId)) issue("Question must appear only once")
    seen.add(answer.questionId)
    if (answer.status !== "answered") {
      if (answer.value !== null) issue("Skipped or hidden answers must have null values")
      continue
    }
    if (answer.questionId === "interests" || answer.questionId === "lower_interest_topics") {
      if (!Array.isArray(answer.value) || answer.value.length === 0 || answer.value.some((v) => !Interest.safeParse(v).success) || new Set(answer.value).size !== answer.value.length) issue("Select one or more distinct known interests")
    } else if (typeof answer.value !== "string" || !choices[answer.questionId].includes(answer.value)) {
      issue("Select a valid option")
    }
  }
  for (const id of ids) if (!seen.has(id)) ctx.addIssue({ code: "custom", path: ["answers"], message: `Missing question: ${id}` })
  const selected = submission.answers.find((answer) => answer.questionId === "interests" && answer.status === "answered")?.value
  const lower = submission.answers.find((answer) => answer.questionId === "lower_interest_topics" && answer.status === "answered")?.value
  if (Array.isArray(selected) && Array.isArray(lower) && selected.some((value) => lower.includes(value))) {
    ctx.addIssue({ code: "custom", path: ["answers"], message: "An interest cannot be selected in both lists" })
  }
})

/** Validate the provisional API-shaped submission before converting to scoring inputs. */
export function surveyForScoring(value: unknown): Survey {
  const submission = SurveySubmissionSchema.parse(value)
  const result: Record<string, string | string[]> = {}
  for (const answer of submission.answers) {
    if (answer.status === "answered" && answer.value !== null) result[answer.questionId] = answer.value
  }
  // The schema validates each value against the scorer's survey_v1 choices.
  return result as Survey
}

export const CourseTagSchema = z.strictObject({
  course_id: z.string().regex(/^[A-Z]{2,4}\s?\d{4}[A-Z]?$/),
  interest_id: Interest,
  source: z.enum(["subject_default", "description_reviewed"]),
  interest_list_version: z.literal("interests_v1"),
  tag_version: z.string().regex(/^tags_v[1-9]\d*$/),
  reviewed_by: z.string().trim().min(1).optional(),
}).superRefine((tag, ctx) => {
  if (tag.source === "description_reviewed" && !tag.reviewed_by) ctx.addIssue({ code: "custom", path: ["reviewed_by"], message: "Description-reviewed tags require a reviewer" })
})

/** Validate provenance before converting a tag to the scorer's input shape. */
export function tagForScoring(value: unknown): Tag {
  const tag = CourseTagSchema.parse(value)
  return { interest: tag.interest_id, source: tag.source }
}
