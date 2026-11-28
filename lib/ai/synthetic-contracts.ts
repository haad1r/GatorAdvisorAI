import { z } from "zod"

// Discussion contract for synthetic fixtures only. This does not establish
// identity, authorize access, fetch evidence, or expose a production tool.
const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/)
const Text = z.string().trim().min(1).max(500)
const Requirement = z.strictObject({
  requirementId: Id,
  status: z.enum(["satisfied", "not_satisfied", "in_progress", "unknown"]),
  completedCredits: z.number().finite().nonnegative().nullable(),
  requiredCredits: z.number().finite().nonnegative().nullable(),
  sourceIds: z.array(Id).max(20),
  unknownReason: Text.nullable(),
}).superRefine((fact, ctx) => {
  if (fact.status === "unknown" && !fact.unknownReason) {
    ctx.addIssue({ code: "custom", path: ["unknownReason"], message: "Unknown status requires a reason" })
  }
})

export const SyntheticToolRequest = z.strictObject({
  tool: z.literal("explain_requirement"),
  requirementId: Id,
})

export const SyntheticAdvisorFactPack = z.strictObject({
  schemaVersion: z.literal("synthetic_fact_pack_v1"),
  recordVersion: Id,
  catalogVersion: Id,
  allowedRequirementIds: z.array(Id).min(1).max(20),
  requirement: Requirement,
  retrievedSources: z.array(z.strictObject({ sourceId: Id, title: Text })).max(20),
}).superRefine((pack, ctx) => {
  const allowed = new Set(pack.allowedRequirementIds)
  const sources = new Set(pack.retrievedSources.map((source) => source.sourceId))
  if (allowed.size !== pack.allowedRequirementIds.length) {
    ctx.addIssue({ code: "custom", path: ["allowedRequirementIds"], message: "Duplicate requirement ID" })
  }
  if (!allowed.has(pack.requirement.requirementId)) {
    ctx.addIssue({ code: "custom", path: ["requirement", "requirementId"], message: "Requirement is not allowlisted" })
  }
  if (sources.size !== pack.retrievedSources.length || new Set(pack.requirement.sourceIds).size !== pack.requirement.sourceIds.length) {
    ctx.addIssue({ code: "custom", path: ["retrievedSources"], message: "Duplicate source ID" })
  }
  if (pack.requirement.sourceIds.some((id) => !sources.has(id))) {
    ctx.addIssue({ code: "custom", path: ["requirement", "sourceIds"], message: "Referenced source was not retrieved" })
  }
})

/** Validate tool input and bind it to the one requirement in a validated pack. */
export function validateSyntheticToolRequest(request: unknown, pack: unknown) {
  const input = SyntheticToolRequest.parse(request)
  const evidence = SyntheticAdvisorFactPack.parse(pack)
  if (input.requirementId !== evidence.requirement.requirementId) {
    throw new Error("Requested requirement does not match the fact pack")
  }
  return { input, evidence }
}
