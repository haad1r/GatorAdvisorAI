import { describe, expect, it } from "vitest"
import { CourseTagSchema, SurveySubmissionSchema, surveyForScoring, tagForScoring } from "./inputs"
import { rank } from "./scoring"

const answers = [
  { questionId: "interests", status: "answered", value: ["ai_data"] },
  { questionId: "lower_interest_topics", status: "answered", value: ["life_sciences"] },
  { questionId: "major_scope", status: "hidden", value: null },
  { questionId: "course_level", status: "answered", value: "intro" },
  { questionId: "requirement_progress", status: "skipped", value: null },
  { questionId: "exploration_mode", status: "answered", value: "exploring" },
]
const submission = () => ({ surveyVersion: "survey_v1", interestListVersion: "interests_v1", submittedAt: "2026-01-01T00:00:00Z", answers: structuredClone(answers) })
const tag = { course_id: "CAP4621", interest_id: "ai_data", source: "description_reviewed", interest_list_version: "interests_v1", tag_version: "tags_v1", reviewed_by: "reviewer" }

describe("versioned recommendation input preparation", () => {
  it("converts a validated survey and reviewed tag into scorer inputs", () => {
    const survey = surveyForScoring(submission())
    expect(survey).toEqual({ interests: ["ai_data"], lower_interest_topics: ["life_sciences"], course_level: "intro", exploration_mode: "exploring" })
    const results = rank([{ code: "CAP 4621", level: "intro", fillsRequirement: false, fillsMajorSlot: false, tags: [tagForScoring(tag)] }], survey)
    expect(results[0].reasons).toContain("Matches your interest in ai_data")
  })
  it("rejects conflicting interests, duplicate questions, and invalid choices", () => {
    const conflict = submission(); conflict.answers[1].value = ["ai_data"]
    const duplicate = submission(); duplicate.answers.push(duplicate.answers[0])
    const invalid = submission(); invalid.answers[3].value = "graduate"
    for (const item of [conflict, duplicate, invalid]) expect(SurveySubmissionSchema.safeParse(item).success).toBe(false)
  })
  it("rejects unknown versions, unknown interests, missing questions and inconsistent status", () => {
    const unknown = submission(); unknown.answers[0].value = ["unknown_interest"]
    const missing = submission(); missing.answers.pop()
    const skipped = submission(); skipped.answers[4].value = "yes"
    for (const item of [unknown, missing, skipped, { ...submission(), surveyVersion: "survey_v9" }]) expect(SurveySubmissionSchema.safeParse(item).success).toBe(false)
  })
  it("requires real provenance for reviewed tags and rejects unsupported versions", () => {
    expect(CourseTagSchema.safeParse({ ...tag, reviewed_by: "" }).success).toBe(false)
    expect(CourseTagSchema.safeParse({ ...tag, reviewed_by: undefined }).success).toBe(false)
    expect(CourseTagSchema.safeParse({ ...tag, interest_list_version: "interests_v2" }).success).toBe(false)
    expect(tagForScoring({ ...tag, source: "subject_default", reviewed_by: undefined })).toEqual({ interest: "ai_data", source: "subject_default" })
  })
})
