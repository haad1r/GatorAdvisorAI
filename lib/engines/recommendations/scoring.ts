// GatorAdvisor scoring baseline: scoring_v1 (PRELIMINARY).
// Follows docs/recommendations/survey.md (survey_v1) and interest-list.md (interests_v1).
// Spec: docs/recommendations/scoring-baseline.md
//
// Pure functions, no I/O. Eligibility and requirement-slot flags are INPUTS that the
// academic engine (TEAM-02) will supply; until then they are only exercised with
// synthetic fixtures in scoring.check.ts. Do not serve live recommendations from this yet.

export type Source = "subject_default" | "description_reviewed"
export type Tag = { interest: string; source: Source }

export type Course = {
  code: string
  tags: Tag[]
  level: "intro" | "advanced"
  fillsMajorSlot: boolean    // from the academic engine (TEAM-02); fake in tests
  fillsRequirement: boolean  // any requirement slot incl. Gen Ed (TEAM-02); fake in tests
}

// Keys are the stable survey_v1 question IDs. undefined = skipped or hidden.
export type Survey = {
  interests?: string[]
  lower_interest_topics?: string[]
  major_scope?: "inside_major" | "mix" | "outside_major"
  course_level?: "intro" | "advanced" | "no_preference"
  requirement_progress?: "yes" | "no_preference"
  exploration_mode?: "exploring" | "settled"
}

export const SCORING_VERSION = "scoring_v1"
const DIVERSITY_STEP = 0.1

// Configurable and versioned. Starting guesses; Ryan reviews them at the design checkpoint.
const WEIGHTS = {
  default:   { interest: 0.50, req: 0.25, major: 0.15, level: 0.10 },
  wantsReqs: { interest: 0.35, req: 0.40, major: 0.15, level: 0.10 },
}

// The survey must never accept the same interest in Q1 and Q2.
export function validateSurvey(s: Survey) {
  const both = (s.interests ?? []).filter((i) => (s.lower_interest_topics ?? []).includes(i))
  if (both.length) throw new Error(`Interest picked in both Q1 and Q2: ${both.join(", ")}`)
}

export function scoreCourse(c: Course, s: Survey) {
  const picked = s.interests ?? []
  const lower = s.lower_interest_topics ?? []
  const noPositiveSignal = picked.length === 0     // Q1 skipped: use the cold-start fallback
  const w = s.requirement_progress === "yes" || noPositiveSignal ? WEIGHTS.wantsReqs : WEIGHTS.default

  const n = c.tags.length
  const hits = c.tags.filter((t) => picked.includes(t.interest))
  // Q2 counts only for description_reviewed tags; subject defaults are too broad to lower a score.
  const lowerHits = c.tags.filter((t) => t.source === "description_reviewed" && lower.includes(t.interest))

  // Interest component: share of the course's tags the student picked, minus the share
  // they marked "less". Can be negative. Skipped Q1 with a filled Q2 still applies Q2.
  // A course with no tags is skipped (missing data is never scored as bad).
  let interest: number | null = null
  if (n > 0) {
    if (!noPositiveSignal) interest = hits.length / n - lowerHits.length / n
    else if (lower.length > 0) interest = 0 - lowerHits.length / n
  }

  const parts = {
    interest,
    req: c.fillsRequirement ? 1 : 0,
    major:
      s.major_scope === "inside_major" ? (c.fillsMajorSlot ? 1 : 0)
      : s.major_scope === "outside_major" ? (c.fillsMajorSlot ? 0 : 1)
      : null,
    level:
      s.course_level === "intro" || s.course_level === "advanced"
        ? (s.course_level === c.level ? 1 : 0)
        : null,
  }

  // Skipped components are dropped and the remaining weights rescaled.
  let total = 0, weightSum = 0
  const components: Record<string, number> = {}
  for (const k of Object.keys(parts) as (keyof typeof parts)[]) {
    const v = parts[k]
    if (v === null) continue
    total += w[k] * v
    weightSum += w[k]
    components[k] = Math.round(w[k] * v * 1000) / 1000 + 0
  }
  const score = Math.round((total / weightSum) * 1000) / 1000 + 0

  // Every reason maps to an input that actually moved the score.
  const reasons = [
    ...(hits.length ? [`Matches your interest in ${hits.map((t) => t.interest).join(", ")}`] : []),
    ...lowerHits.map((t) => `Lowered: tagged ${t.interest} (${t.source})`),
    ...(c.fillsRequirement ? ["Counts toward a requirement"] : []),
    ...(s.major_scope === "inside_major" && c.fillsMajorSlot ? ["Counts toward your major"] : []),
  ]
  return { code: c.code, score, components, reasons }
}

// Sort by score, then course code (stable). When exploring, or when Q1 was skipped, spread
// the list: each already-chosen course that shares a tag lowers the next one a little.
export function rank(courses: Course[], s: Survey) {
  validateSurvey(s)
  const spread = s.exploration_mode === "exploring" || !(s.interests?.length)
  const pool = courses.map((c) => ({ c, r: scoreCourse(c, s) }))
  const out: typeof pool = []
  const shares = (a: Course, b: Course) => a.tags.some((t) => b.tags.some((u) => u.interest === t.interest))
  while (pool.length) {
    const adj = (x: (typeof pool)[number]) =>
      x.r.score - (spread ? DIVERSITY_STEP * out.filter((o) => shares(o.c, x.c)).length : 0)
    pool.sort((a, b) => adj(b) - adj(a) || a.r.code.localeCompare(b.r.code))
    out.push(pool.shift()!)
  }
  return out.map((x, i) => ({ rank: i + 1, ...x.r, scoring_version: SCORING_VERSION }))
}
