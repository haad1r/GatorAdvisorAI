import { z } from "zod"

// Prototype only: inputs are synthetic and no identity, persistence or live engine
// integration is provided. Provider prose is never displayed.
const Identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/)
const Fact = z.strictObject({
  requirementId: Identifier,
  status: z.enum(["satisfied", "not_satisfied", "in_progress", "unknown"]),
  completedCredits: z.number().finite().nonnegative().nullable(),
  requiredCredits: z.number().finite().nonnegative().nullable(),
  sourceId: Identifier.nullable(),
})
const Claim = Fact
const FactPack = z.strictObject({ fact: Fact, retrievedSourceIds: z.array(Identifier).max(100) })

export type RequirementFact = z.infer<typeof Fact>
export type SyntheticFactPack = { fact: RequirementFact; retrievedSourceIds: string[] }
export type SyntheticProvider = (pack: SyntheticFactPack, signal: AbortSignal) => Promise<unknown>

function render(fact: RequirementFact): string {
  const status = fact.status.replaceAll("_", " ")
  const credits = fact.completedCredits !== null && fact.requiredCredits !== null
    ? ` ${fact.completedCredits} of ${fact.requiredCredits} credits completed.` : " Credit details are unknown."
  return `Requirement ${fact.requirementId}: ${status}.${credits}`
}

/** Validates one structured claim; all displayed text is rendered locally. */
export async function explainSyntheticRequirement(pack: SyntheticFactPack, provider: SyntheticProvider, timeoutMs = 5000) {
  const parsed = FactPack.parse(pack)
  const fact = parsed.fact
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new RangeError("timeoutMs must be between 1 and 60000")
  const retrievedSourceIds = parsed.retrievedSourceIds
  const fallback = () => ({
    kind: "engine_fallback" as const,
    text: render(fact),
    sourceId: fact.sourceId && retrievedSourceIds.includes(fact.sourceId) ? fact.sourceId : null,
  })
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // Copy the fixture so a mock cannot mutate the evidence used for validation.
    const input = { fact: { ...fact }, retrievedSourceIds: [...retrievedSourceIds] }
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Provider timed out")) }, timeoutMs)
    })
    const result = Claim.safeParse(await Promise.race([provider(input, controller.signal), timeout]))
    if (!result.success) return fallback()
    const claim = result.data
    if (claim.requirementId !== fact.requirementId || claim.status !== fact.status ||
        claim.completedCredits !== fact.completedCredits || claim.requiredCredits !== fact.requiredCredits ||
        claim.sourceId !== fact.sourceId || !claim.sourceId || !retrievedSourceIds.includes(claim.sourceId)) {
      return fallback()
    }
    return { kind: "validated" as const, text: render(fact), sourceId: claim.sourceId }
  } catch {
    return fallback()
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Synthetic freshness exercise; the caller must supply its own version reader. */
export async function explainIfSyntheticEvidenceCurrent(
  pack: SyntheticFactPack,
  recordVersion: string,
  readCurrentVersion: () => Promise<string>,
  provider: SyntheticProvider,
) {
  const unavailable = { kind: "evidence_unavailable" as const, text: "Current evidence must be refreshed before answering.", sourceId: null }
  if (!recordVersion) return unavailable
  try {
    if (await readCurrentVersion() !== recordVersion) return unavailable
    const response = await explainSyntheticRequirement(pack, provider)
    if (await readCurrentVersion() !== recordVersion) return unavailable
    return response
  } catch {
    return unavailable
  }
}
