import { toScoringFlags, type AcademicEngine } from ".."
import { toCourseId, type Term } from "../schemas/common"
import { rank, type Survey, type Tag } from "./scoring"

/**
 * Local synthetic integration exercise only. No API, authentication, stored
 * feedback, section-level checks or live-student use. All candidate decisions
 * come from the engine; supplied tags and dismissals are synthetic inputs.
 */
export function recommendSynthetic(
  engine: AcademicEngine,
  record: unknown,
  courseCodes: readonly string[],
  term: Term,
  survey: Survey,
  tags: Readonly<Record<string, Tag[]>>,
  dismissedCodes: readonly string[] = [],
) {
  const dismissed = new Set(dismissedCodes.map(toCourseId))
  const filtered = engine.filterCandidates(record, courseCodes, term)
  const candidates = new Map<string, (typeof filtered.courses)[number]>()
  const excludedByPreference: string[] = []
  const unsupportedLevel: string[] = []
  for (const candidate of filtered.courses) {
    if (candidate.decision !== "candidate" || !candidate.courseId || candidates.has(candidate.courseId)) continue
    if (dismissed.has(candidate.courseId)) {
      if (!excludedByPreference.includes(candidate.courseId)) excludedByPreference.push(candidate.courseId)
      continue
    }
    const level = Number(candidate.courseId.slice(3, 4))
    if (level < 1 || level > 4) {
      if (!unsupportedLevel.includes(candidate.courseId)) unsupportedLevel.push(candidate.courseId)
      continue
    }
    candidates.set(candidate.courseId, candidate)
  }
  const flags = engine.requirementFlags(record, [...candidates.keys()])
  const versionKeys = ["contractVersion", "engineVersion", "dataVersion", "catalogYear", "recordId", "recordVersion"] as const
  if (versionKeys.some((key) => filtered.versions[key] !== flags.versions[key])) {
    throw new Error("Academic evidence changed between filtering and scoring")
  }
  const flagMap = new Map(flags.courses.map((flag) => [flag.courseId, flag]))
  const scored = rank(flags.courses.map((flag) => ({
    code: flag.code,
    level: Number(flag.courseId[3]) < 3 ? "intro" as const : "advanced" as const,
    tags: tags[flag.courseId] ?? [],
    ...toScoringFlags(flag),
  })), survey)
  return {
    term: filtered.term, versions: filtered.versions, decisions: filtered.courses,
    dismissed: excludedByPreference, unsupportedLevel,
    results: scored.map((row) => {
      const id = toCourseId(row.code)
      const candidate = candidates.get(id)!
      const flag = flagMap.get(id)!
      if (candidate.eligibility !== "eligible" && candidate.eligibility !== "eligible_pending") throw new Error("Candidate eligibility is not usable")
      if (candidate.offering !== "confirmed" && candidate.offering !== "historical") throw new Error("Candidate offering is not usable")
      return { ...row, courseId: id, eligibility: candidate.eligibility, offering: candidate.offering,
        eligibilityState: candidate.eligibility === "eligible" ? "eligible_for_target_term" as const : "conditional_for_target_term" as const,
        offeringState: candidate.offering === "confirmed" ? "confirmed_course_offering" as const : "historical_course_offering" as const,
        eligibilityReasons: candidate.reasons, requirements: flag.requirements, requirementReasons: flag.reasons }
    }),
  }
}
