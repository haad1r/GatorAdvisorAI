"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ChevronRightIcon, SearchIcon, StarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { EmptyState } from "@/components/feedback/empty-state"
import { LoadFailed } from "@/components/feedback/load-failed"
import { LoadingBlock } from "@/components/feedback/loading-block"
import { SHOW_RMP } from "@/components/ratings/instructor-rating"
import type { CourseFilters, CourseSearchResult, CourseSummary } from "@/lib/api/types"
import { useApi } from "@/lib/api/use-api"
import { useLoad } from "@/lib/api/use-load"
import { CREDIT_OPTIONS, GEN_ED_LABEL, LEVELS, QUEST_LABEL, formatCredits } from "./labels"

const FILTER_KEYS = ["q", "department", "level", "genEd", "credits", "page"] as const

function filtersFrom(params: URLSearchParams): CourseFilters {
  return {
    q: params.get("q") ?? undefined,
    department: params.get("department") ?? undefined,
    level: Number(params.get("level")) || undefined,
    genEd: (params.get("genEd") as CourseFilters["genEd"]) ?? undefined,
    credits: Number(params.get("credits")) || undefined,
    page: Number(params.get("page")) || undefined,
  }
}

/* /courses (#21): search and filter the catalog. Filters live in the URL so Back and shared links keep them. */
export function CourseSearch() {
  const api = useApi()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const query = params.toString()
  const filters = React.useMemo(() => filtersFrom(new URLSearchParams(query)), [query])

  const fetcher = React.useCallback(() => api.getCourses(filters), [api, filters])
  const { state, retry } = useLoad(fetcher)
  // Keep the last results' department list while new results load.
  const [departments, setDepartments] = React.useState<CourseSearchResult["departments"]>([])
  if (state.kind === "ok" && state.data.departments !== departments) setDepartments(state.data.departments)

  const [text, setText] = React.useState(filters.q ?? "")
  // When the URL's q changes from outside (Back, Clear), show it in the box.
  // Changes this box made itself are ignored, so typing isn't overwritten.
  const [pushedQ, setPushedQ] = React.useState(filters.q ?? "")
  const [seenQ, setSeenQ] = React.useState(filters.q ?? "")
  if ((filters.q ?? "") !== seenQ) {
    setSeenQ(filters.q ?? "")
    if ((filters.q ?? "") !== pushedQ) {
      setPushedQ(filters.q ?? "")
      setText(filters.q ?? "")
    }
  }

  const setParam = React.useCallback(
    (key: (typeof FILTER_KEYS)[number], value: string | undefined) => {
      const next = new URLSearchParams(query)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== "page") next.delete("page")
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, query, router]
  )

  // Search as you type, after a short pause.
  React.useEffect(() => {
    if ((filters.q ?? "") === text.trim()) return
    const t = setTimeout(() => {
      setPushedQ(text.trim())
      setParam("q", text.trim() || undefined)
    }, 300)
    return () => clearTimeout(t)
  }, [text, filters.q, setParam])

  const active = FILTER_KEYS.some((k) => k !== "page" && params.get(k))

  return (
    <div className="flex flex-col gap-5">
      <form role="search" className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setParam("q", text.trim() || undefined) }}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="course-q">Search courses</Label>
          <div className="relative">
            <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input id="course-q" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. COP3530, calculus, ethics" className="h-15 rounded-xl pl-12 text-base md:text-sm" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Filter id="f-department" label="Department" value={filters.department} onChange={(v) => setParam("department", v)}>
            {departments.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
              </option>
            ))}
          </Filter>
          <Filter id="f-level" label="Level" value={filters.level ? String(filters.level) : undefined} onChange={(v) => setParam("level", v)}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}-level
              </option>
            ))}
          </Filter>
          <Filter id="f-gened" label="Gen Ed" value={filters.genEd} onChange={(v) => setParam("genEd", v)}>
            {Object.entries(GEN_ED_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
            {Object.entries(QUEST_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Filter>
          <Filter id="f-credits" label="Credits" value={filters.credits ? String(filters.credits) : undefined} onChange={(v) => setParam("credits", v)}>
            {CREDIT_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Filter>
        </div>
        {active && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => {
              setText("")
              router.replace(pathname, { scroll: false })
            }}
          >
            Clear search and filters
          </Button>
        )}
      </form>

      <section aria-labelledby="course-results" className="flex flex-col gap-3">
        <h2 id="course-results" className="sr-only">
          Results
        </h2>
        {/* Nothing is listed until there's a search or a filter, so the page starts clean. */}
        {state.kind === "error" && <LoadFailed error={state.error} onRetry={retry} />}
        {active && state.kind === "loading" && <LoadingBlock />}
        {active && state.kind === "ok" && <Results data={state.data} onPage={(p) => setParam("page", String(p))} />}
        {!active && state.kind !== "error" && (
          <p className="text-sm text-muted-foreground">Search by course code or name, or pick a filter to browse.</p>
        )}
      </section>
    </div>
  )
}

function Filter({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string
  label: string
  value: string | undefined
  onChange: (value: string | undefined) => void
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} className="h-11" value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Any</option>
        {children}
      </NativeSelect>
    </div>
  )
}

function Results({ data, onPage }: { data: CourseSearchResult; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  return (
    <>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {data.total === 0
          ? "No courses match."
          : `${data.total} ${data.total === 1 ? "course" : "courses"} · showing ${(data.page - 1) * data.pageSize + 1}–${Math.min(data.total, data.page * data.pageSize)}`}
      </p>
      {data.total === 0 ? (
        <EmptyState title="No courses match" description="Try fewer filters, or search by course code (COP3530) or a word in the title." />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.results.map((c) => (
            <li key={c.id}>
              <CourseCard course={c} term={data.term.name} />
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav aria-label="Result pages" className="flex items-center justify-between gap-3">
          <Button variant="outline" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {data.page} of {pages}
          </span>
          <Button variant="outline" disabled={data.page >= pages} onClick={() => onPage(data.page + 1)}>
            Next
          </Button>
        </nav>
      )}
      <p className="text-xs text-muted-foreground">Preview catalog: 300 real UF courses. The full catalog arrives with the backend.</p>
    </>
  )
}

function CourseCard({ course: c, term }: { course: CourseSummary; term: string }) {
  const tags = [...c.genEd.map((g) => GEN_ED_LABEL[g]), ...(c.quest ? [QUEST_LABEL[c.quest]] : [])]
  return (
    <Link
      href={`/courses/${c.id}`}
      className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-brand-blue/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{c.code}</span>
          <span className="min-w-0">{c.name}</span>
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{formatCredits(c.credits)}</span>
          <span>{c.offeredNextTerm ? `Offered ${term}` : `Not offered ${term}`}</span>
          {SHOW_RMP && c.bestRating && (
            <span className="inline-flex items-center gap-1 text-foreground">
              <StarIcon aria-hidden="true" className="size-3.5" />
              <span>
                {c.bestRating.quality.toFixed(1)}
                <span className="text-muted-foreground"> top professor rating</span>
              </span>
            </span>
          )}
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
      </div>
      <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}
