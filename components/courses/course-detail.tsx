"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeftIcon, ExternalLinkIcon, HelpCircleIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/feedback/empty-state"
import { LoadFailed } from "@/components/feedback/load-failed"
import { LoadingBlock } from "@/components/feedback/loading-block"
import { InstructorRating, SHOW_RMP } from "@/components/ratings/instructor-rating"
import type { CourseDetail, InstructorSections } from "@/lib/api/types"
import { useApi } from "@/lib/api/use-api"
import { useLoad } from "@/lib/api/use-load"
import { formatDate } from "@/lib/format"
import { DELIVERY_LABEL, GEN_ED_LABEL, QUEST_LABEL, formatCredits, formatSeasons } from "./labels"

/* /courses/[id] (#21): one course, its prerequisites, and who teaches it. */
export function CourseDetailView({ id }: { id: string }) {
  const api = useApi()
  const fetcher = React.useCallback(() => api.getCourse(id), [api, id])
  const { state, retry } = useLoad(fetcher)

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Link href="/courses" className="inline-flex items-center gap-1.5 self-start text-sm text-brand-blue underline-offset-4 hover:underline">
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        All courses
      </Link>
      {state.kind === "loading" && <LoadingBlock />}
      {state.kind === "error" &&
        (state.error.code === "NOT_FOUND" ? (
          <EmptyState size="lg" title="Course not found" description="This course isn't in the catalog. Check the code, or search for it." />
        ) : (
          <LoadFailed error={state.error} onRetry={retry} />
        ))}
      {state.kind === "ok" && <Detail course={state.data} />}
    </div>
  )
}

function Card({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4 lg:px-6 lg:py-5">
      <h2 id={id} className="text-base font-semibold lg:text-lg">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Detail({ course: c }: { course: CourseDetail }) {
  const tags = [...c.genEd.map((g) => GEN_ED_LABEL[g]), ...(c.quest ? [QUEST_LABEL[c.quest]] : [])]
  const seasons = formatSeasons(c.seasons)
  return (
    <>
      <section aria-labelledby="course-title" className="flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4 lg:px-6 lg:py-5">
        <h2 id="course-title" className="flex flex-wrap items-baseline gap-x-3 text-xl font-semibold">
          <span>{c.code}</span>
          <span className="font-normal">{c.name}</span>
        </h2>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{formatCredits(c.credits)}</span>
          <span>{c.department.name}</span>
          {seasons && <span>Usually offered: {seasons}</span>}
        </p>
        {tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Gen Ed">
            {tags.map((t) => (
              <li key={t} className="rounded-full border border-border px-2 text-xs">
                {t}
              </li>
            ))}
          </ul>
        )}
        {c.description && <p className="text-[15px] leading-relaxed">{c.description}</p>}
        <p className="text-xs text-muted-foreground">
          Source:{" "}
          <a href={c.source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-brand-blue underline underline-offset-4">
            {c.source.label}
            <ExternalLinkIcon aria-hidden="true" className="size-3" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          , read {formatDate(c.source.fetchedAt)}
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card id="course-reqs" title="Prerequisites">
          {c.requisites.length === 0 ? (
            <p className="text-sm">None listed.</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {c.requisites.map((r) => (
                <li key={r.kind} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">{r.kind === "prereq" ? "Prerequisite" : "Corequisite"}</span>
                  <span>{r.text}</span>
                  {r.status !== "complete" && (
                    <span className="text-xs text-muted-foreground">
                      We couldn&apos;t fully read this rule, so it won&apos;t be checked automatically. Ask your advisor if you&apos;re unsure.
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card id="course-eligible" title="Can I take this?">
          {/* Eligibility comes only from the audit engine (#8). Never decided here. */}
          <p className="flex items-start gap-2 text-sm">
            <HelpCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-medium">Not checked yet.</span> Once your degree audit is connected, this will say whether you meet the
              prerequisites, based on your courses.
            </span>
          </p>
        </Card>
      </div>

      <Professors course={c} />
    </>
  )
}

function Professors({ course: c }: { course: CourseDetail }) {
  const [termCode, setTermCode] = React.useState(c.terms[0]?.code)
  const term = c.terms.find((t) => t.code === termCode) ?? c.terms[0]
  const sectionCount = term ? term.groups.reduce((n, g) => n + g.sections.length, 0) : 0

  return (
    <section aria-labelledby="course-profs" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="course-profs" className="text-base font-semibold lg:text-lg">
            {SHOW_RMP ? "Compare professors" : "Who teaches it"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {SHOW_RMP ? "Best-rated first. Ratings come from RateMyProfessors and describe the professor, not this exact class." : "Instructors and their sections."}
          </p>
        </div>
        <div role="group" aria-label="Term" className="flex rounded-lg border border-border p-0.5">
          {c.terms.map((t) => (
            <Button
              key={t.code}
              variant="ghost"
              aria-pressed={t.code === term?.code}
              onClick={() => setTermCode(t.code)}
              className={cn("h-9 px-4 text-[15px]", t.code === term?.code && "bg-muted text-foreground")}
            >
              {t.name}
            </Button>
          ))}
        </div>
      </div>

      <div aria-live="polite" className="flex flex-col gap-3">
        {!term || term.groups.length === 0 ? (
          <EmptyState title={`Not offered ${term?.name ?? ""}`} description="No sections are scheduled that term." />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {sectionCount} {sectionCount === 1 ? "section" : "sections"} in {term.name}. Meeting times aren&apos;t in UF&apos;s public data yet.
            </p>
            <ul className="flex flex-col gap-3">
              {term.groups.map((g, i) => (
                <li key={i}>
                  <GroupCard group={g} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}

function GroupCard({ group: g }: { group: InstructorSections }) {
  const deliveries = [...new Set(g.sections.map((s) => DELIVERY_LABEL[s.delivery]))]
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      {g.instructors.length === 0 ? (
        <p className="font-medium">Instructor not announced yet</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {g.instructors.map((i) => (
            <InstructorRating key={i.name} instructor={i} />
          ))}
        </div>
      )}
      <details className="border-t border-border pt-2">
        <summary className="cursor-pointer text-muted-foreground">
          {g.sections.length} {g.sections.length === 1 ? "section" : "sections"} · {deliveries.join(", ")}
        </summary>
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {g.sections.map((s) => (
            <li key={s.classNumber}>
              Section {s.section} <span className="text-muted-foreground">· class #{s.classNumber}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
