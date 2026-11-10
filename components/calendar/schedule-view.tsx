"use client"

import * as React from "react"
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, ListIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/feedback/empty-state"
import { ErrorPanel } from "@/components/feedback/error-panel"
import { LoadingBlock } from "@/components/feedback/loading-block"
import { toErrorPanel } from "@/lib/api/errors"
import type { ApiError, WeekSchedule } from "@/lib/api/types"
import { useApi } from "@/lib/api/use-api"
import { addDays, daysToShow, formatWeekRange, mondayOf, todayInGainesville, unscheduled } from "@/lib/schedule"
import { AgendaList } from "./agenda-list"
import { UnscheduledList } from "./unscheduled-list"
import { WeekGrid } from "./week-grid"

type State =
  | { kind: "loading" }
  | { kind: "ok"; data: WeekSchedule }
  | { kind: "error"; error: ApiError }

export function ScheduleView() {
  const api = useApi()
  const [today] = React.useState(() => todayInGainesville())
  const thisWeek = mondayOf(today)
  const [weekStart, setWeekStart] = React.useState(thisWeek)
  const [view, setView] = React.useState<"grid" | "list">("grid")
  const [state, setState] = React.useState<State>({ kind: "loading" })
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    let live = true
    api.getSchedule(weekStart).then((result) => {
      if (!live) return
      setState(result.ok ? { kind: "ok", data: result.data } : { kind: "error", error: result.error })
    })
    return () => {
      live = false
    }
  }, [api, weekStart, attempt])

  function goTo(week: string) {
    setState({ kind: "loading" })
    setWeekStart(week)
  }

  const meetings = state.kind === "ok" ? state.data.meetings : []
  const days = daysToShow(weekStart, meetings)
  const timed = meetings.filter((m) => m.time)

  return (
    /*
     * data-wide widens AppShell's content to 100rem. On desktop the view is
     * exactly the space between the top bar and the footer (5rem top bar,
     * 2.5rem padding top and bottom, ~2.6rem footer), so the page never scrolls;
     * the grid shrinks to fit and scrolls inside itself if it must.
     */
    <div data-wide className="flex flex-col gap-4 lg:h-[calc(100dvh-12.6rem)] lg:min-h-[32rem]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-10 [&_svg]:size-5" aria-label="Previous week" onClick={() => goTo(addDays(weekStart, -7))}>
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <Button variant="outline" size="icon" className="size-10 [&_svg]:size-5" aria-label="Next week" onClick={() => goTo(addDays(weekStart, 7))}>
            <ChevronRightIcon aria-hidden="true" />
          </Button>
          <Button variant="outline" className="h-10 px-4 text-[15px]" disabled={weekStart === thisWeek} onClick={() => goTo(thisWeek)}>
            This week
          </Button>
        </div>
        <h2 aria-live="polite" className="ml-1 min-w-0 text-xl font-semibold tracking-tight">
          {formatWeekRange(weekStart, days.length)}
          {state.kind === "ok" && <span className="ml-2 text-base font-normal tracking-normal text-muted-foreground">{state.data.term}</span>}
        </h2>

        <div role="group" aria-label="View" className="ml-auto hidden rounded-lg border border-border p-0.5 lg:flex">
          {(
            [
              ["grid", "Week", CalendarDaysIcon],
              ["list", "List", ListIcon],
            ] as const
          ).map(([value, label, Icon]) => (
            <Button
              key={value}
              variant="ghost"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={cn("h-9 gap-2 px-4 text-[15px]", view === value && "bg-muted text-foreground")}
            >
              <Icon aria-hidden="true" />
              {label}
            </Button>
          ))}
        </div>
      </div>

      {state.kind === "loading" && <LoadingBlock />}

      {state.kind === "error" && (
        <div className="flex flex-col items-start gap-3">
          <ErrorPanel {...toErrorPanel(state.error)} />
          <Button variant="outline" onClick={() => { setState({ kind: "loading" }); setAttempt((n) => n + 1) }}>
            Try again
          </Button>
        </div>
      )}

      {state.kind === "ok" && meetings.length === 0 && (
        <EmptyState size="lg" title="No classes this week" description="Classes you add to your schedule will show here." />
      )}

      {state.kind === "ok" && meetings.length > 0 && (
        <>
          {timed.length > 0 && (
            <>
              {/* Phones and tablets always get the list; desktop gets the chosen view. */}
              <div className={cn(view === "grid" ? "lg:hidden" : "lg:min-h-0 lg:flex-1 lg:overflow-y-auto")}>
                <AgendaList days={days} meetings={meetings} today={today} />
              </div>
              {view === "grid" && (
                <WeekGrid days={days} meetings={meetings} today={today} className="hidden min-h-0 flex-1 lg:block" />
              )}
            </>
          )}
          <UnscheduledList meetings={unscheduled(meetings)} />
        </>
      )}
    </div>
  )
}
