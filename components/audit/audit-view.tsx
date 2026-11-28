"use client"

import * as React from "react"
import { ChevronDownIcon, ExternalLinkIcon, HelpCircleIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { Label } from "@/components/ui/label"
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
    <div className="flex flex-col gap-10">
      <AuditSummary audit={data} />
      {data.unknowns.length > 0 && <Unknowns audit={data} onShow={(id) => showRequirement(id, data, chooseTab)} />}

      <section aria-labelledby="audit-results" className="flex flex-col gap-4">
        <h2 id="audit-results" className="sr-only">
          Requirements
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Requirement type" className="flex flex-wrap gap-0.5 rounded-full bg-muted p-1">
            {TABS.map(([value, label]) => (
              <Button
                key={value}
                variant="ghost"
                aria-pressed={tab === value}
                onClick={() => chooseTab(value)}
                className={cn(
                  "h-9 rounded-full px-4 text-[15px] text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent",
                  tab === value && "bg-background font-semibold text-foreground shadow-[0_1px_2px_rgba(14,21,37,0.08)] hover:bg-background dark:hover:bg-background"
                )}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor="status-filter" className="text-muted-foreground">
              Show
            </Label>
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
  // In-progress credits as a share of the bar, after the earned part.
  const inProgressShare = credits.required > 0 ? Math.round((credits.inProgress / credits.required) * 100) : 0
  return (
    <section aria-labelledby="audit-summary" className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
      <h2 id="audit-summary" className="sr-only">
        Summary: {audit.program.name}, {audit.program.catalogYear} catalog, checked {formatDate(audit.generatedAt)}
      </h2>
      <div className="flex flex-col gap-5">
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-5xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">{credits.earned}</span>
          <span className="text-lg text-muted-foreground">of {credits.required} credits</span>
        </p>
        <ProgressBar percent={audit.percentComplete} inProgress={inProgressShare} label="Degree progress" showLabel={false} />
        <p className="text-sm text-muted-foreground">
          {credits.inProgress} in progress · {credits.remaining} to go
        </p>
      </div>

      <dl className="flex flex-wrap gap-x-10 gap-y-4">
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
    <section aria-labelledby="audit-unknowns" className="flex flex-col gap-2 rounded-xl bg-attention px-5 py-4 text-attention-foreground">
      <h2 id="audit-unknowns" className="flex items-center gap-2 font-semibold">
        <HelpCircleIcon aria-hidden="true" className="size-4" />
        {audit.unknowns.length === 1 ? "1 thing we couldn't check" : `${audit.unknowns.length} things we couldn't check`}
      </h2>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-foreground">
        {audit.unknowns.map((u, i) => (
          <li key={i}>
            {u.message}
            {u.requirementId && titleOf(u.requirementId) ? (
              <>
                {" "}
                <button
                  type="button"
                  className="rounded-sm font-semibold text-attention-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() => onShow(u.requirementId!)}
                >
                  Show {titleOf(u.requirementId)}
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ---------- requirements ---------- */

function RequirementList({ audit, category, filter }: { audit: DegreeAudit; category: RequirementCategory; filter: ResultStatus | "all" }) {
  const inTab = audit.requirements.filter((r) => r.category === category)
  if (inTab.length === 0) {
    return category === "minor" ? (
      <EmptyState title="No minor on your record" description="Adding a minor to your profile isn't available yet." />
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
    <ul className="flex flex-col border-t border-border">
      {shown.map((r) => (
        <li key={r.id} className="border-b border-border">
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
  const bar = requirementShares(r)
  return (
    <details id={`req-${r.id}`} className="group">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-4 rounded-lg px-1 py-3 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 font-semibold">{r.title}</span>
        {bar && (
          <span aria-hidden="true" className="hidden h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-track sm:flex">
            <span className="h-full bg-track-done" style={{ width: `${bar.earned}%` }} />
            <span className="h-full bg-primary" style={{ width: `${bar.pending}%` }} />
          </span>
        )}
        {progress ? <span className="hidden w-32 shrink-0 text-right text-sm text-muted-foreground sm:block">{progress}</span> : null}
        <span className="flex w-28 shrink-0 justify-end">
          <ResultStatusBadge status={r.status} />
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <div className="flex flex-col gap-4 px-1 pt-1 pb-5 text-sm">
        {progress ? <p className="text-muted-foreground sm:hidden">{progress}</p> : null}
        <p>{r.reason}</p>

        {r.counted.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">Counted courses</h3>
            <ul className="flex flex-col gap-1.5">
              {r.counted.map((c) => {
                const shared = sharedWith(c.courseCode)
                return (
                  <li key={c.courseCode} className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-mono font-medium">{formatCourseCode(c.courseCode)}</span>
                    <span className="text-muted-foreground">
                      {c.inProgress ? "In progress" : c.source === "exam" ? "Exam credit" : c.grade} · {c.credits} cr{c.source === "exam" ? "" : ` · ${c.term}`}
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

/**
 * Earned and in-progress shares (0-100) for a requirement's small bar, counted
 * the same way as its "x of y" text (credits or courses). null when the
 * requirement isn't counted either way.
 */
function requirementShares(r: RequirementResult) {
  const byCredits = r.needed.credits != null
  const need = byCredits ? r.needed.credits : r.needed.courses
  if (!need) return null
  const done = byCredits ? r.earned.credits : r.earned.courses
  const pending = r.counted.filter((c) => c.inProgress).reduce((sum, c) => sum + (byCredits ? c.credits : 1), 0)
  const earned = Math.min(100, Math.round((done / need) * 100))
  return { earned, pending: Math.min(100 - earned, Math.round((pending / need) * 100)) }
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
    <ol className="flex flex-col border-t border-border">
      {shown.map((m) => (
        <li key={m.id} className="border-b border-border">
          <MilestoneCard milestone={m} next={tracking.nextDeadline?.id === m.id} />
        </li>
      ))}
    </ol>
  )
}

function MilestoneCard({ milestone: m, next }: { milestone: TrackingMilestone; next: boolean }) {
  return (
    <div className="flex flex-col gap-2 px-1 py-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Semester {m.semester} · due {m.deadlineTerm}
        </span>
        {next && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-orange-text">
            <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
            Next deadline
          </span>
        )}
        <ResultStatusBadge status={m.status} className="ml-auto" />
      </div>
      <p className="font-medium">{m.description}</p>
      <p>{m.reason}</p>
      <Sources sources={m.sources} />
    </div>
  )
}
