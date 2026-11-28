import { describe, expect, it } from "vitest"
import { rank, scoreCourse, SCORING_VERSION, type Course } from "./scoring"

const course = (code: string, interest: string): Course => ({
  code, level: "intro", fillsRequirement: true, fillsMajorSlot: false,
  tags: [{ interest, source: "description_reviewed" }],
})

describe("recommendation explanations", () => {
  it("reports the diversity adjustment at selection time without changing the base score", () => {
    const rows = rank([course("AAA 1000", "art"), course("BBB 1000", "art"), course("CCC 1000", "music")], {})
    expect(rows.map((r) => r.code)).toEqual(["AAA 1000", "CCC 1000", "BBB 1000"])
    expect(rows[2]).toMatchObject({ score: 1, diversity_penalty: 0.1, adjusted_score: 0.9, scoring_version: SCORING_VERSION })
    expect(rows[2].reasons).toContain("Diversity adjustment: -0.1 for overlap with earlier courses")
    expect(rows[0].diversity_penalty).toBe(0)
  })
  it("does not apply diversity when a settled user has positive interests", () => {
    const rows = rank([course("AAA 1000", "art"), course("BBB 1000", "art")], { interests: ["art"], exploration_mode: "settled" })
    expect(rows.every((r) => r.diversity_penalty === 0 && r.adjusted_score === r.score)).toBe(true)
  })
  it("explains matching level and outside-major preferences only when they contribute", () => {
    const c = course("AAA 1000", "art")
    expect(scoreCourse(c, { major_scope: "outside_major", course_level: "intro" }).reasons).toEqual(expect.arrayContaining([
      "Matches your preference for courses outside your major requirements", "Matches your preferred intro course level",
    ]))
    expect(scoreCourse(c, { major_scope: "inside_major", course_level: "advanced" }).reasons).not.toEqual(expect.arrayContaining([
      "Matches your preferred intro course level",
    ]))
  })
  it("does not interpret unknown requirement flags as an outside-major match", () => {
    const unknown = { ...course("AAA 1000", "art"), fillsRequirement: null, fillsMajorSlot: null, tags: [] }
    const result = scoreCourse(unknown, { major_scope: "outside_major" })
    expect(result.score).toBe(0)
    expect(result.components).not.toHaveProperty("req")
    expect(result.components).not.toHaveProperty("major")
    expect(result.reasons).not.toContain("Matches your preference for courses outside your major requirements")
    expect(rank([unknown], { major_scope: "outside_major" })[0].score).toBe(0)
  })
  it("rejects duplicate interest tags rather than double-counting conflicting provenance", () => {
    const duplicate = course("AAA 1000", "art")
    duplicate.tags.push({ interest: "art", source: "subject_default" })
    expect(() => rank([duplicate], { interests: ["art"] })).toThrow(/Duplicate interest tags/)
  })
  it("matches the original ranking on varied synthetic pools, including multiple shared tags", () => {
    for (let seed = 0; seed < 12; seed++) {
      const courses = Array.from({ length: 45 }, (_, i) => {
        const c = course(`C${String((i * 17 + seed) % 45).padStart(3, "0")}`, `tag${(i + seed) % 7}`)
        if (i % 3 === 0) c.tags.push({ interest: `tag${(i + seed + 1) % 7}`, source: "subject_default" })
        c.fillsRequirement = i % 4 !== 0
        return c
      })
      const survey = seed % 2 ? { interests: ["tag1"], exploration_mode: "settled" as const } : {}
      const pool = courses.map((c) => ({ c, score: scoreCourse(c, survey).score }))
      const chosen: typeof pool = []
      while (pool.length) {
        const adjusted = (item: (typeof pool)[number]) => item.score - (seed % 2 ? 0 : 0.1 * chosen.filter((prior) => prior.c.tags.some((tag) => item.c.tags.some((other) => tag.interest === other.interest))).length)
        pool.sort((a, b) => adjusted(b) - adjusted(a) || a.c.code.localeCompare(b.c.code))
        chosen.push(pool.shift()!)
      }
      expect(rank(courses, survey).map((row) => row.code)).toEqual(chosen.map((row) => row.c.code))
    }
  })
  it("changes ranking when survey interests change and handles untagged courses", () => {
    const art = { ...course("AAA 1000", "art"), fillsRequirement: false }
    const music = { ...course("BBB 1000", "music"), fillsRequirement: false }
    const untagged = { ...course("CCC 1000", "unused"), tags: [], fillsRequirement: false }
    expect(rank([art, music, untagged], { interests: ["art"], exploration_mode: "settled" })[0].code).toBe(art.code)
    expect(rank([art, music, untagged], { interests: ["music"], exploration_mode: "settled" })[0].code).toBe(music.code)
    expect(rank([untagged], {})[0].score).toBe(0)
  })
  it("only penalizes a lower-interest topic when its tag is reviewed", () => {
    const reviewed = course("AAA 1000", "art")
    const defaultTag = { ...course("BBB 1000", "art"), tags: [{ interest: "art", source: "subject_default" as const }] }
    const survey = { lower_interest_topics: ["art"] }
    expect(scoreCourse(reviewed, survey).score).toBeLessThan(scoreCourse(defaultTag, survey).score)
    expect(scoreCourse(defaultTag, survey).reasons.some((reason) => reason.startsWith("Lowered:"))).toBe(false)
  })
  it("does not change the score for unrelated or unreviewed tags when only Q2 is answered", () => {
    const unreviewed = { ...course("AAA 1000", "art"), tags: [{ interest: "art", source: "subject_default" as const }] }
    const unrelated = course("BBB 1000", "music")
    for (const item of [unreviewed, unrelated]) {
      expect(scoreCourse(item, { lower_interest_topics: ["art"] }).score).toBe(scoreCourse(item, {}).score)
      expect(scoreCourse(item, { lower_interest_topics: ["art"] }).components).not.toHaveProperty("interest")
    }
    expect(scoreCourse(course("CCC 1000", "art"), { lower_interest_topics: ["art"] }).score).toBeLessThan(scoreCourse(course("CCC 1000", "art"), {}).score)
  })
})
