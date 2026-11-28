import { AuditResult } from "../engines/schemas/results"

/**
 * Adapt a schema-validated audit fixture to the single-requirement prototype.
 * This is not authenticated, does not retrieve sources, and is not for live data.
 */
export function adaptSyntheticAuditRequirement(auditValue: unknown, requirementKey: string) {
  const audit = AuditResult.parse(auditValue)
  const requirement = audit.requirements.find((entry) => entry.requirementKey === requirementKey)
  if (!requirement) throw new Error("Requirement was not found in the audit")
  // Source references indicate provenance but are not proof of retrieval.
  // Do not assign a source ID until a separate retrieval validates one.
  return {
    fact: {
      requirementId: requirement.requirementKey,
      status: requirement.status,
      completedCredits: requirement.required.credits === null ? null : requirement.completed.credits,
      requiredCredits: requirement.required.credits,
      sourceId: null,
    },
    versions: audit.versions,
    sourceReferences: requirement.sources,
    reasons: requirement.reasons,
  }
}
