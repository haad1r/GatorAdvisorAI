"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { LoadFailed } from "@/components/feedback/load-failed"
import { LoadingBlock } from "@/components/feedback/loading-block"
import { ResultStatusBadge } from "@/components/feedback/result-status-badge"
import { ProgressBar, Stat } from "@/components/audit/stats"
import { useApi } from "@/lib/api/use-api"
import { useLoad } from "@/lib/api/use-load"

/*
 * Dashboard (#21): progress, next Critical Tracking deadline, and anything
 * that needs attention. The "top recommendations" and "continue planning"
 * cards wait on the recommendations (#11) and plan (#8) shapes.
 */
export function DashboardView() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ProgressCard />
      <NextDeadlineCard />
      <AttentionCard />
    </div>
  )
}

function Card({ id, title, children, className }: { id: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-4 rounded-xl border border-border bg-card px-5 py-4 lg:px-6 lg:py-5", className)}>
      <h2 id={id} className="text-base font-semibold lg:text-lg">
        {title}
      </h2>
      {children}
    </section>
  )
}

function ProgressCard() {
  const api = useApi()
  const fetcher = React.useCallback(() => api.getAudit(), [api])
  const { state, retry } = useLoad(fetcher)

  return (
    <Card id="dash-progress" title="Your progress" className="lg:col-span-2">
      {state.kind === "loading" && <LoadingBlock />}
      {state.kind === "error" && <LoadFailed error={state.error} onRetry={retry} />}
      {state.kind === "ok" && (
        <>
          <p className="-mt-2 text-sm text-muted-foreground">
            {state.data.program.name} · {state.data.program.catalogYear} catalog
          </p>
          <ProgressBar percent={state.data.percentComplete} label="Degree progress" />
          <dl className="grid grid-cols-3 gap-x-6">
            <Stat term="Earned" value={`${state.data.credits.earned} credits`} />
            <Stat term="In progress" value={`${state.data.credits.inProgress} credits`} />
            <Stat term="Remaining" value={`${state.data.credits.remaining} credits`} />
          </dl>
          <Button variant="outline" className="self-start" render={<Link href="/audit" />} nativeButton={false}>
            View degree audit
          </Button>
        </>
      )}
    </Card>
  )
}

function NextDeadlineCard() {
  const api = useApi()
  const fetcher = React.useCallback(() => api.getTracking(), [api])
  const { state, retry } = useLoad(fetcher)

  return (
    <Card id="dash-deadline" title="Next tracking deadline">
      {state.kind === "loading" && <LoadingBlock />}
      {state.kind === "error" && <LoadFailed error={state.error} onRetry={retry} />}
      {state.kind === "ok" &&
        (state.data.nextDeadline ? (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Due {state.data.nextDeadline.deadlineTerm}</span>
              <ResultStatusBadge status={state.data.nextDeadline.status} className="ml-auto" />
            </div>
            <p className="font-medium">{state.data.nextDeadline.description}</p>
            <p>{state.data.nextDeadline.reason}</p>
          </div>
        ) : (
          <p className="text-sm">You&apos;re caught up. No tracking deadlines left.</p>
        ))}
    </Card>
  )
}

function AttentionCard() {
  const api = useApi()
  const auditFetcher = React.useCallback(() => api.getAudit(), [api])
  const courseFetcher = React.useCallback(() => api.getCoursework(), [api])
  const audit = useLoad(auditFetcher)
  const courses = useLoad(courseFetcher)

  // Each half shows on its own, so one failed request doesn't hide the other's result.
  const loading = audit.state.kind === "loading" || courses.state.kind === "loading"
  const failed = audit.state.kind === "error" || courses.state.kind === "error"
  const unknowns = audit.state.kind === "ok" ? audit.state.data.unknowns.length : 0
  const toReview = courses.state.kind === "ok" ? courses.state.data.rows.filter((r) => r.status === "needs-review").length : 0

  return (
    <Card id="dash-attention" title="Needs your attention">
      {loading && !failed && unknowns === 0 && toReview === 0 && <LoadingBlock />}
      {audit.state.kind === "error" && <LoadFailed error={audit.state.error} onRetry={audit.retry} />}
      {courses.state.kind === "error" && <LoadFailed error={courses.state.error} onRetry={courses.retry} />}
      {!loading && !failed && unknowns === 0 && toReview === 0 && <p className="text-sm">Nothing right now.</p>}
      {(unknowns > 0 || toReview > 0) && (
        <ul className="flex flex-col gap-3 text-sm">
          {unknowns > 0 && (
            <li className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {unknowns === 1 ? "1 requirement" : `${unknowns} requirements`} we couldn&apos;t check
              </span>
              <Button variant="outline" size="sm" render={<Link href="/audit" />} nativeButton={false}>
                See audit
              </Button>
            </li>
          )}
          {toReview > 0 && (
            <li className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {toReview === 1 ? "1 course needs" : `${toReview} courses need`} review
              </span>
              <Button variant="outline" size="sm" render={<Link href="/import" />} nativeButton={false}>
                Review courses
              </Button>
            </li>
          )}
        </ul>
      )}
    </Card>
  )
}
