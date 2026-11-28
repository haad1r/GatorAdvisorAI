"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "cn"
import { LoadFailed } from "@/components/feedback/load-failed"
import { LoadingBlock } from "@/components/feedback/loading-block"
import type { Coursework, DegreeAudit, Profile } from "@/lib/api/types"
import { useApi } from "@/lib/api/use-api"
import { useLoad } from "@/lib/api/use-load"
import { formatCourseCode } from "@/lib/format"
import { termOrder } from "@/lib/onboarding"
import { daysToShow, formatTime, meetingsOn, mondayOf, todayInGainesville } from "@/lib/schedule"
import { shortTerm, termForDate, termsBetween } from "@/lib/terms"

/*
 * Dashboard (#21): the student's path to graduation, what needs attention,
 * and today's classes. Every number comes from the API; nothing is predicted.
 * The "top recommendations" and "continue planning" parts wait on the
 * recommendations (#11) and plan (#8) shapes.
 */
export function DashboardView() {
  const [today] = React.useState(() => todayInGainesville())
  return (
    <div className="flex flex-col gap-12 lg:gap-14">
      <PathSection today={today} />
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-14">
        <NextUpSection />
        <TodaySection today={today} />
      </div>
    </div>
  )
}

const linkClass =
  "shrink-0 rounded-sm text-sm font-semibold text-brand-orange-text outline-none hover:underline underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50"

function SectionHead({ id, title, link }: { id: string; title: string; link?: { href: string; label: string } }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 id={id} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {link && (
        <Link href={link.href} className={linkClass}>
          {link.label}
        </Link>
      )}
    </div>
  )
}

/* ---------- path to graduation ---------- */

type TermBar = { term: string; state: "done" | "now" | "planned"; credits: number | null }

function PathSection({ today }: { today: string }) {
  const api = useApi()
  const profile = useLoad(React.useCallback(() => api.getProfile(), [api]))
  const audit = useLoad(React.useCallback(() => api.getAudit(), [api]))
  const coursework = useLoad(React.useCallback(() => api.getCoursework(), [api]))

  const failed = [profile, audit, coursework].find((l) => l.state.kind === "error")

  return (
    <section aria-labelledby="dash-path">
      {failed && failed.state.kind === "error" ? (
        <>
          <h2 id="dash-path" className="mb-3 text-lg font-semibold tracking-tight">
            Expected graduation
          </h2>
          <LoadFailed error={failed.state.error} onRetry={failed.retry} />
        </>
      ) : profile.state.kind === "ok" && audit.state.kind === "ok" && coursework.state.kind === "ok" ? (
        <PathSummary profile={profile.state.data} audit={audit.state.data} coursework={coursework.state.data} today={today} />
      ) : (
        <>
          <h2 id="dash-path" className="mb-3 text-lg font-semibold tracking-tight">
            Expected graduation
          </h2>
          <LoadingBlock />
        </>
      )}
    </section>
  )
}

function PathSummary({ profile, audit, coursework, today }: { profile: Profile; audit: DegreeAudit; coursework: Coursework; today: string }) {
  const bars = buildTermBars(profile, audit, coursework, today)
  const graduation = profile.expectedGraduation

  return (
    <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
      <div className="flex flex-col gap-3">
        <h2 id="dash-path" className="text-base text-muted-foreground">
          Expected graduation
        </h2>
        {graduation ? (
          <p className="text-5xl leading-none font-semibold tracking-[-0.04em] sm:text-6xl">{graduation}</p>
        ) : (
          <p className="text-lg">
            Not set yet.{" "}
            <Link href="/settings" className={linkClass}>
              Add it in Settings
            </Link>
          </p>
        )}
        <p className="text-[15px] text-muted-foreground">
          <span className="font-semibold text-foreground">{audit.credits.earned}</span> of {audit.credits.required} credits earned
        </p>
      </div>

      {bars.length > 0 && <TermTimeline bars={bars} />}
    </div>
  )
}

/**
 * One bar per term from the student's first term to their expected graduation.
 * Past terms: credits from their coursework (exam credit has no real term, so
 * it is left out). This term: the audit's in-progress credits. Later terms:
 * an empty slot, never a guessed number.
 */
function buildTermBars(profile: Profile, audit: DegreeAudit, coursework: Coursework, today: string): TermBar[] {
  const taken = coursework.rows.filter((r) => r.source !== "exam")
  const summers = taken.map((r) => r.term).filter((t) => t.startsWith("Summer"))
  const terms = termsBetween(profile.entryTerm, profile.expectedGraduation, summers)
  const now = termOrder(termForDate(today))
  if (now == null) return []

  return terms.map((term) => {
    const order = termOrder(term)!
    if (order < now) {
      const credits = taken.filter((r) => r.term === term).reduce((sum, r) => sum + r.credits, 0)
      return { term, state: "done", credits }
    }
    if (order === now) return { term, state: "now", credits: audit.credits.inProgress }
    return { term, state: "planned", credits: null }
  })
}

function TermTimeline({ bars }: { bars: TermBar[] }) {
  const scale = Math.max(18, ...bars.map((b) => b.credits ?? 0))
  const first = bars[0].term
  const last = bars[bars.length - 1].term

  return (
    <div className="min-w-0 overflow-x-auto">
      <ol aria-label={`Your terms, ${first} to ${last}`} className="flex min-w-[22rem] items-end gap-2 sm:gap-2.5">
        {bars.map((b) => (
          <li key={b.term} className="flex min-w-0 flex-1 flex-col items-stretch gap-2.5">
            <div aria-hidden="true" className="flex h-32 items-end sm:h-36">
              <div
                className={cn(
                  "w-full rounded-md",
                  b.state === "done" && "bg-track-done",
                  b.state === "now" && "bg-primary",
                  b.state === "planned" && "h-full bg-track"
                )}
                style={b.state === "planned" ? undefined : { height: `${Math.max(4, ((b.credits ?? 0) / scale) * 100)}%` }}
              />
            </div>
            <span aria-hidden="true" className={cn("text-center text-xs", b.state === "now" ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {b.state === "now" ? "Now" : shortTerm(b.term)}
            </span>
            <span className="sr-only">{termDescription(b)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function termDescription(b: TermBar) {
  if (b.state === "done") return `${b.term}: ${b.credits} credits completed.`
  if (b.state === "now") return `${b.term}, this term: ${b.credits} credits in progress.`
  return `${b.term}: planned.`
}

/* ---------- next up ---------- */

function NextUpSection() {
  const api = useApi()
  const tracking = useLoad(React.useCallback(() => api.getTracking(), [api]))
  const audit = useLoad(React.useCallback(() => api.getAudit(), [api]))
  const courses = useLoad(React.useCallback(() => api.getCoursework(), [api]))

  // Each part shows on its own, so one failed request doesn't hide the others' results.
  const loading = [tracking, audit, courses].some((l) => l.state.kind === "loading")
  const deadline = tracking.state.kind === "ok" ? tracking.state.data.nextDeadline : null
  const unknowns = audit.state.kind === "ok" ? audit.state.data.unknowns.length : 0
  const toReview = courses.state.kind === "ok" ? courses.state.data.rows.filter((r) => r.status === "needs-review").length : 0
  const items: { key: string; urgent?: boolean; text: React.ReactNode; href: string; action: string }[] = []

  if (deadline) {
    items.push({
      key: "deadline",
      urgent: true,
      text: (
        <>
          {deadline.description} <span className="font-normal text-muted-foreground">· due {deadline.deadlineTerm}</span>
        </>
      ),
      href: "/audit",
      action: "Details",
    })
  }
  if (unknowns > 0) {
    items.push({
      key: "unknowns",
      text: `${unknowns === 1 ? "1 requirement" : `${unknowns} requirements`} we couldn't check`,
      href: "/audit",
      action: "See audit",
    })
  }
  if (toReview > 0) {
    items.push({
      key: "review",
      text: `${toReview === 1 ? "1 course needs" : `${toReview} courses need`} review`,
      href: "/import",
      action: "Review",
    })
  }

  return (
    <section aria-labelledby="dash-next">
      <SectionHead id="dash-next" title="Next up" />
      <div className="flex flex-col gap-3">
        {tracking.state.kind === "error" && <LoadFailed error={tracking.state.error} onRetry={tracking.retry} />}
        {audit.state.kind === "error" && <LoadFailed error={audit.state.error} onRetry={audit.retry} />}
        {courses.state.kind === "error" && <LoadFailed error={courses.state.error} onRetry={courses.retry} />}
      </div>
      {items.length > 0 ? (
        <ul className="border-t border-border">
          {items.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-4 border-b border-border py-4">
              <span className="flex min-w-0 items-baseline gap-3 font-semibold">
                {item.urgent && <span aria-hidden="true" className="size-2 shrink-0 translate-y-[-1px] rounded-full bg-primary" />}
                <span className="min-w-0">{item.text}</span>
              </span>
              <Link href={item.href} className={linkClass}>
                {item.action}
              </Link>
            </li>
          ))}
        </ul>
      ) : loading ? (
        <LoadingBlock />
      ) : (
        <p className="border-y border-border py-4 text-muted-foreground">Nothing needs your attention right now.</p>
      )}
    </section>
  )
}

/* ---------- today ---------- */

function TodaySection({ today }: { today: string }) {
  const api = useApi()
  const weekStart = mondayOf(today)
  const { state, retry } = useLoad(React.useCallback(() => api.getSchedule(weekStart), [api, weekStart]))
  const weekday = daysToShow(weekStart).find((d) => d.date === today)?.weekday

  return (
    <section aria-labelledby="dash-today">
      <SectionHead id="dash-today" title="Today" link={{ href: "/schedule", label: "Full schedule" }} />
      {state.kind === "loading" && <LoadingBlock />}
      {state.kind === "error" && <LoadFailed error={state.error} onRetry={retry} />}
      {state.kind === "ok" && <TodayList meetings={weekday ? meetingsOn(weekday, state.data.meetings) : []} />}
    </section>
  )
}

function TodayList({ meetings }: { meetings: ReturnType<typeof meetingsOn> }) {
  if (meetings.length === 0) {
    return <p className="border-y border-border py-4 text-muted-foreground">No classes today.</p>
  }
  return (
    <ul className="border-t border-border">
      {meetings.map((m) => (
        <li key={m.id} className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-baseline gap-3 border-b border-border py-3.5">
          <span className="text-sm text-muted-foreground">{formatTime(m.time!.start)}</span>
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            <span className="font-mono text-[15px] font-medium">{formatCourseCode(m.courseCode)}</span>
            <span className="truncate text-muted-foreground">{m.location ?? (m.online ? "Online" : "Location TBA")}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
