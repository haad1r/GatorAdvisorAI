import { describe, expect, it } from "vitest"
import type { SurveySubmission } from "../api/types"
import { hasErrors } from "../forms"
import {
  INTEREST_GROUPS,
  INTEREST_IDS,
  QUESTION_IDS,
  initialDraft,
  toSubmission,
  validateSurvey,
} from "../survey"

const NOW = new Date("2026-11-28T15:00:00.000Z")

function answer(sub: SurveySubmission, id: string) {
  return sub.answers.find((a) => a.questionId === id)
}

describe("survey schema", () => {
  it("has the six stable question ids in order", () => {
    expect(QUESTION_IDS).toEqual([
      "interests",
      "lower_interest_topics",
      "major_scope",
      "course_level",
      "requirement_progress",
      "exploration_mode",
    ])
  })

  it("has 22 unique interests in 6 groups", () => {
    expect(INTEREST_GROUPS).toHaveLength(6)
    expect(INTEREST_IDS).toHaveLength(22)
    expect(new Set(INTEREST_IDS).size).toBe(22)
  })
})

describe("toSubmission", () => {
  it("always sends all six answers, skipped ones as null", () => {
    const sub = toSubmission({ course_level: "advanced", interests: ["ai_data"] }, "computer-science", NOW)
    expect(sub.surveyVersion).toBe("survey_v1")
    expect(sub.interestListVersion).toBe("interests_v1")
    expect(sub.submittedAt).toBe("2026-11-28T15:00:00.000Z")
    expect(sub.answers.map((a) => a.questionId)).toEqual(QUESTION_IDS)
    expect(answer(sub, "interests")).toEqual({ questionId: "interests", status: "answered", value: ["ai_data"] })
    expect(answer(sub, "course_level")).toEqual({ questionId: "course_level", status: "answered", value: "advanced" })
    expect(answer(sub, "major_scope")).toEqual({ questionId: "major_scope", status: "skipped", value: null })
  })

  it("never sends an empty answer", () => {
    const sub = toSubmission({ interests: [], course_level: "" }, "computer-science", NOW)
    expect(answer(sub, "interests")).toEqual({ questionId: "interests", status: "skipped", value: null })
    expect(answer(sub, "course_level")).toEqual({ questionId: "course_level", status: "skipped", value: null })
  })

  it("hides Q3 for undeclared students even if a value is left over", () => {
    const sub = toSubmission({ major_scope: "mix" }, "undeclared", NOW)
    expect(answer(sub, "major_scope")).toEqual({ questionId: "major_scope", status: "hidden", value: null })
  })

  it("produces submissions that pass validation", () => {
    expect(validateSurvey(toSubmission({}, "undeclared", NOW))).toEqual({})
    expect(
      validateSurvey(
        toSubmission(
          {
            interests: ["ai_data", "life_sciences"],
            lower_interest_topics: ["politics_law"],
            major_scope: "outside_major",
            course_level: "intro",
            requirement_progress: "yes",
            exploration_mode: "settled",
          },
          "computer-science",
          NOW
        )
      )
    ).toEqual({})
  })
})

describe("initialDraft", () => {
  it("starts Q6 at exploring for undeclared students with no history", () => {
    expect(initialDraft(null, "undeclared")).toEqual({ exploration_mode: "exploring" })
    expect(initialDraft(null, "computer-science")).toEqual({})
  })

  it("pre-fills a retake from the last submission's answered values only", () => {
    const last = toSubmission({ interests: ["ai_data"], course_level: "advanced" }, "computer-science", NOW)
    expect(initialDraft(last, "computer-science")).toEqual({ interests: ["ai_data"], course_level: "advanced" })
  })

  it("keeps an explicit 'settled' over the undeclared default on a retake", () => {
    const last = toSubmission({ exploration_mode: "settled" }, "undeclared", NOW)
    expect(initialDraft(last, "undeclared")).toEqual({ exploration_mode: "settled" })
  })

  it("drops a saved Q3 answer once the major becomes undeclared", () => {
    const last = toSubmission({ major_scope: "mix" }, "computer-science", NOW)
    expect(initialDraft(last, "undeclared")).toEqual({})
  })
})

describe("validateSurvey", () => {
  const valid = () => toSubmission({ interests: ["ai_data"] }, "computer-science", NOW)

  it("rejects the same topic in Q1 and Q2 on the Q2 question", () => {
    const sub = toSubmission({ interests: ["ai_data"], lower_interest_topics: ["ai_data"] }, "computer-science", NOW)
    expect(validateSurvey(sub).lower_interest_topics?.[0]).toMatch(/AI & Data Science/)
  })

  it("rejects a missing question", () => {
    const sub = valid()
    sub.answers = sub.answers.filter((a) => a.questionId !== "course_level")
    expect(validateSurvey(sub).course_level).toBeDefined()
  })

  it("rejects a duplicated question", () => {
    const sub = valid()
    sub.answers.push({ questionId: "interests", status: "skipped", value: null })
    expect(validateSurvey(sub).interests).toBeDefined()
  })

  it("rejects empty answers and values on skipped answers", () => {
    const sub = valid()
    sub.answers[0] = { questionId: "interests", status: "answered", value: [] }
    sub.answers[3] = { questionId: "course_level", status: "skipped", value: "intro" }
    const errors = validateSurvey(sub)
    expect(errors.interests).toBeDefined()
    expect(errors.course_level).toBeDefined()
  })

  it("rejects unknown topics, repeated topics and unknown options", () => {
    const sub = valid()
    sub.answers[0] = { questionId: "interests", status: "answered", value: ["not_a_topic"] }
    sub.answers[1] = { questionId: "lower_interest_topics", status: "answered", value: ["politics_law", "politics_law"] }
    sub.answers[3] = { questionId: "course_level", status: "answered", value: "graduate" }
    const errors = validateSurvey(sub)
    expect(errors.interests).toBeDefined()
    expect(errors.lower_interest_topics).toBeDefined()
    expect(errors.course_level).toBeDefined()
  })

  it("rejects wrong versions, bad timestamps and non-objects under 'survey'", () => {
    const sub = { ...valid(), surveyVersion: "survey_v0", submittedAt: "yesterday" }
    expect(validateSurvey(sub).survey).toHaveLength(2)
    expect(hasErrors(validateSurvey(null))).toBe(true)
    expect(hasErrors(validateSurvey({ ...valid(), answers: "nope" }))).toBe(true)
  })
})
