"use client"

import * as React from "react"
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { EmptyState } from "@/components/feedback/empty-state"
import { LoadFailed } from "@/components/feedback/load-failed"
import { LoadingBlock } from "@/components/feedback/loading-block"
import { RESULT_STATUS_LABEL, ResultStatusBadge, type ResultStatus } from "@/components/feedback/result-status-badge"
import type {
  AuditStatus,
  DegreeAudit,
  GpaKind,
  RequirementCategory,
  RequirementResult,
  SourceReference,
  TrackingMilestone,
  TrackingResult,
  TrackingStatus,
} from "@/lib/api/types"
import { useApi } from "@/lib/api/use-api"
import { useLoad } from "@/lib/api/use-load"
import { formatCourseCode, formatDate, formatProgress } from "@/lib/format"
import { ProgressBar, Stat } from "./stats"

type Tab = RequirementCategory | "tracking"

const TABS: [Tab, string][] = [
  ["major", "Major"],
  ["gen_ed", "Gen Ed"],
  ["minor", "Minor"],
  ["tracking", "Tracking"],
]

const AUDIT_STATUSES: AuditStatus[] = ["not_met", "in_progress", "unknown", "met"]
const TRACKING_STATUSES: TrackingStatus[] = ["at_risk", "not_met", "unknown", "met"]

const GPA_LABEL: Record<GpaKind, string> = {
  overall: "Overall GPA",
  major: "Major GPA",
  upper_division: "Upper-division GPA",
}

/* Degree audit (#21). Every value comes from the API; this screen only displays it. */
export function AuditView() {
  const api = useApi()
  const auditFetcher = React.useCallback(() => api.getAudit(), [api])
  const trackingFetcher = React.useCallback(() => api.getTracking(), [api])
  const audit = useLoad(auditFetcher)
  const tracking = useLoad(trackingFetcher)

  const [tab, setTab] = React.useState<Tab>("major")
  const [filter, setFilter] = React.useState<ResultStatus | "all">("all")

  function chooseTab(next: Tab) {
    setTab(next)
    setFilter("all")
  }

  if (audit.state.kind === "loading") return <LoadingBlock />
  if (audit.state.kind === "error") return <LoadFailed error={audit.state.error} onRetry={audit.retry} />

  const data = audit.state.data
  const statuses = tab === "tracking" ? TRACKING_STATUSES : AUDIT_STATUSES

  return (
    <div className="flex flex-col gap-6">
      <AuditSummary audit={data} />
      {data.unknowns.length > 0 && <Unknowns audit={data} onShow={(id) => showRequirement(id, data, chooseTab)} />}

      <section aria-labelledby="audit-results" className="flex flex-col gap-4">
        <h2 id="audit-results" className="sr-only">
          Requirements
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div role="group" aria-label="Requirement type" className="flex flex-wrap rounded-lg border border-border p-0.5">
            {TABS.map(([value, label]) => (
              <Button
                key={value}
                variant="ghost"
                aria-pressed={tab === value}
                onClick={() => chooseTab(value)}
                className={cn("h-9 px-4 text-[15px]", tab === value && "bg-muted text-foreground")}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex flex-col gap-1.5">
            <Label htmlFor="status-filter">Show</Label>
            <NativeSelect id="status-filter" value={filter} onChange={(e) => setFilter(e.target.value as ResultStatus | "all")}>
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {RESULT_STATUS_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <div aria-live="polite">
          {tab === "tracking" ? (
            tracking.state.kind === "loading" ? (
              <LoadingBlock />
            ) : tracking.state.kind === "error" ? (
              <LoadFailed error={tracking.state.error} onRetry={tracking.retry} />
            ) : (
              <TrackingList tracking={tracking.state.data} filter={filter} />
            )
          ) : (
            <RequirementList audit={data} category={tab} filter={filter} />
          )}
        </div>
      </section>
    </div>
  )
}

/** Jump to a requirement from the unknowns list: switch tab, then open and focus its card. */
function showRequirement(id: string, audit: DegreeAudit, chooseTab: (tab: Tab) => void) {
  const requirement = audit.requirements.find((r) => r.id === id)
  if (!requirement) return
  chooseTab(requirement.category)
  requestAnimationFrame(() => {
    const el = document.getElementById(`req-${id}`) as HTMLDetailsElement | null
    if (!el) return
    el.open = true
    el.querySelector("summary")?.focus()
    el.scrollIntoView({ block: "center" })
  })
}

/* ---------- summary ---------- */

function AuditSummary({ audit }: { audit: DegreeAudit }) {
  const { credits } = audit
  return (
    <section aria-labelledby="audit-summary" className="flex flex-col gap-4 rounded-xl border border-border bg-card px-5 py-4 lg:px-6 lg:py-5">
      <div>
        <h2 id="audit-summary" className="text-base font-semibold lg:text-lg">
          {audit.program.name}
        </h2>
        <p className="text-sm text-muted-foreground">
          {audit.program.catalogYear} catalog · checked {formatDate(audit.generatedAt)}
        </p>
      </div>

      <ProgressBar percent={audit.percentComplete} label="Degree progress" />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat term="Earned" value={`${credits.earned} credits`} />
        <Stat term="In progress" value={`${credits.inProgress} credits`} />
        <Stat term="Remaining" value={`${credits.remaining} credits`} />
        <Stat term="Required" value={`${credits.required} credits`} />
      </dl>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-t border-border pt-4 sm:grid-cols-3">
        {audit.gpa.map((g) => (
          <Stat key={g.kind} term={GPA_LABEL[g.kind]} value={g.value != null ? g.value.toFixed(2) : "—"} note={g.note} />
        ))}
      </dl>
    </section>
  )
}

function Unknowns({ audit, onShow }: { audit: DegreeAudit; onShow: (id: string) => void }) {
  const titleOf = (id: string | null) => audit.requirements.find((r) => r.id === id)?.title
  return (
    <Alert>
      <AlertTitle>
        {audit.unknowns.length === 1 ? "1 thing we couldn't check" : `${audit.unknowns.length} things we couldn't check`}
      </AlertTitle>
      <AlertDescription>
        <p>We won&apos;t guess. Ask your advisor about these, or fix your record if something is missing.</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          {audit.unknowns.map((u, i) => (
            <li key={i}>
              {u.message}
              {u.requirementId && titleOf(u.requirementId) ? (
                <>
                  {" "}
                  <button type="button" className="text-brand-blue underline underline-offset-4" onClick={() => onShow(u.requirementId!)}>
                    Show {titleOf(u.requirementId)}
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

/* ---------- requirements ---------- */

function RequirementList({ audit, category, filter }: { audit: DegreeAudit; category: RequirementCategory; filter: ResultStatus | "all" }) {
  const inTab = audit.requirements.filter((r) => r.category === category)
  if (inTab.length === 0) {
    return category === "minor" ? (
      <EmptyState title="No minor on your record" description="Add a minor in Settings to see its requirements here." />
    ) : (
      <EmptyState title="No requirements to show" description="Your program has no requirements of this type." />
    )
  }
  const shown = filter === "all" ? inTab : inTab.filter((r) => r.status === filter)
  if (shown.length === 0) {
    return <EmptyState title="Nothing matches this filter" description="Choose another status, or All statuses." />
  }
  const titleOf = (id: string) => audit.requirements.find((r) => r.id === id)?.title ?? id

  return (
    <ul className="flex flex-col gap-3">
      {shown.map((r) => (
        <li key={r.id}>
          <RequirementCard
            requirement={r}
            sharedWith={(code) =>
              audit.sharedCourses
                .find((s) => s.courseCode === code)
                ?.requirementIds.filter((id) => id !== r.id)
                .map(titleOf) ?? []
            }
          />
        </li>
      ))}
    </ul>
  )
}

function RequirementCard({ requirement: r, sharedWith }: { requirement: RequirementResult; sharedWith: (code: string) => string[] }) {
  const progress = formatProgress(r.needed, r.earned)
  return (
    <details id={`req-${r.id}`} className="group rounded-xl border border-border bg-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="font-medium">{r.title}</span>
          {progress ? <span className="text-sm text-muted-foreground">{progress}</span> : null}
        </span>
        <ResultStatusBadge status={r.status} />
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <div className="flex flex-col gap-4 border-t border-border px-4 py-3 text-sm">
        <p>{r.reason}</p>

        {r.counted.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">Counted courses</h3>
            <ul className="flex flex-col gap-1">
              {r.counted.map((c) => {
                const shared = sharedWith(c.courseCode)
                return (
                  <li key={c.courseCode} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{formatCourseCode(c.courseCode)}</span>
                    <span className="text-muted-foreground">
                      {c.inProgress ? "In progress" : c.grade} · {c.credits} cr · {c.term}
                    </span>
                    {shared.length > 0 && <span className="text-muted-foreground">· Also counts toward {shared.join(", ")}</span>}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {r.stillToTake.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">Still to take</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {r.stillToTake.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}

        <Sources sources={r.sources} />
      </div>
    </details>
  )
}

function Sources({ sources }: { sources: SourceReference[] }) {
  if (sources.length === 0) return null
  return (
    <p className="text-xs text-muted-foreground">
      Source:{" "}
      {sources.map((s, i) => (
        <React.Fragment key={s.url}>
          {i > 0 ? "; " : null}
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-brand-blue underline underline-offset-4">
            {s.label}
            <ExternalLinkIcon aria-hidden="true" className="size-3" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          , read {formatDate(s.fetchedAt)}
        </React.Fragment>
      ))}
    </p>
  )
}

/* ---------- tracking ---------- */

function TrackingList({ tracking, filter }: { tracking: TrackingResult; filter: ResultStatus | "all" }) {
  const shown = filter === "all" ? tracking.milestones : tracking.milestones.filter((m) => m.status === filter)
  if (tracking.milestones.length === 0) {
    return <EmptyState title="No Critical Tracking for your program" description="Your program has no tracking milestones." />
  }
  if (shown.length === 0) {
    return <EmptyState title="Nothing matches this filter" description="Choose another status, or All statuses." />
  }
  return (
    <ol className="flex flex-col gap-3">
      {shown.map((m) => (
        <li key={m.id}>
          <MilestoneCard milestone={m} next={tracking.nextDeadline?.id === m.id} />
        </li>
      ))}
    </ol>
  )
}

function MilestoneCard({ milestone: m, next }: { milestone: TrackingMilestone; next: boolean }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border bg-card px-4 py-3 text-sm", next ? "border-brand-blue" : "border-border")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Semester {m.semester} · due {m.deadlineTerm}
        </span>
        {next && <span className="rounded-full border border-brand-blue px-2 text-xs font-medium text-brand-blue">Next deadline</span>}
        <ResultStatusBadge status={m.status} className="ml-auto" />
      </div>
      <p className="font-medium">{m.description}</p>
      <p>{m.reason}</p>
      <Sources sources={m.sources} />
    </div>
  )
}
