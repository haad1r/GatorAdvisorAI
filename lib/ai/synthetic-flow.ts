import { validateSyntheticToolRequest } from "./synthetic-contracts"
import { lookupSyntheticPolicy } from "./synthetic-policy"
import { explainIfSyntheticEvidenceCurrent, type SyntheticProvider } from "./synthetic-requirement"

// A fixture-only exercise, not a live route, tool registry, or authorization boundary.
export async function runSyntheticAdvisorFlow(options: {
  request: unknown
  factPack: unknown
  policyFixtures: unknown
  readCurrentRecordVersion: () => Promise<string>
  provider: SyntheticProvider
}) {
  const unavailable = { kind: "evidence_unavailable" as const, text: "Current evidence must be refreshed before answering.", sourceId: null }
  try {
    const { evidence } = validateSyntheticToolRequest(options.request, options.factPack)
    // The synthetic topic is the requirement ID; no model chooses the topic.
    const result = lookupSyntheticPolicy({ topicId: evidence.requirement.requirementId, catalogYear: evidence.catalogVersion }, options.policyFixtures)
    if (result.kind !== "found" || evidence.requirement.sourceIds.length === 0) return unavailable
    const byId = new Map(result.sources.map((source) => [source.sourceId, source]))
    if (evidence.requirement.sourceIds.some((id) => !byId.has(id))) return unavailable
    // Do not trust source titles supplied by the fact pack to prove retrieval.
    if (evidence.retrievedSources.some((source) => byId.get(source.sourceId)?.title !== source.title)) return unavailable
    const fact = evidence.requirement
    return await explainIfSyntheticEvidenceCurrent({
      fact: { requirementId: fact.requirementId, status: fact.status, completedCredits: fact.completedCredits,
        requiredCredits: fact.requiredCredits, sourceId: fact.sourceIds[0] },
      retrievedSourceIds: result.sources.map((source) => source.sourceId),
    }, evidence.recordVersion, options.readCurrentRecordVersion, options.provider)
  } catch {
    return unavailable
  }
}
