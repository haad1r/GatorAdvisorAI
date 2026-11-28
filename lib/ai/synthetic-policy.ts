import { z } from "zod"

// Offline fixture lookup only: no network, official policy or authorization.
const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/)
const Year = z.string().regex(/^\d{4}-\d{4}$/).refine((value) => Number(value.slice(5)) === Number(value.slice(0, 4)) + 1)
const Source = z.strictObject({
  sourceId: Id,
  topicId: Id,
  catalogYear: Year,
  observedAt: z.iso.date(),
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(2000),
})
const Request = z.strictObject({ topicId: Id, catalogYear: Year })
const Sources = z.array(Source).max(100).superRefine((sources, ctx) => {
  if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) {
    ctx.addIssue({ code: "custom", message: "Source IDs must be unique" })
  }
})

/** Exact topic/year lookup. Returned text is untrusted source data, not instructions. */
export function lookupSyntheticPolicy(request: unknown, fixtures: unknown) {
  const query = Request.parse(request)
  const sources = Sources.parse(fixtures)
  const matches = sources.filter((source) => source.topicId === query.topicId && source.catalogYear === query.catalogYear)
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
  if (matches.length === 0) return { kind: "unknown" as const, sources: [] }
  return { kind: "found" as const, sources: matches }
}
