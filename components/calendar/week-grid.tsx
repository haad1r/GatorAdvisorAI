import { cn } from "cn"
import type { ScheduleMeeting } from "@/lib/api/types"
import { type CalendarDay, formatTime, layoutLanes, meetingsOn, toMinutes } from "@/lib/schedule"
import { CalendarEvent } from "./calendar-event"

/* Below this the grid scrolls inside itself instead of squashing meetings. 72px/hour gives a
   50-minute class room for course and time on two lines. */
const MIN_PX_PER_HOUR = 72

/**
 * Desktop week grid. It fills the height it is given (pass one via
 * className): hour rows stretch to fit, positions are percentages of the
 * day, and the grid scrolls internally with pinned day headers only when
 * the space is too short. Each day is a labelled section with its meetings
 * in time order, so screen readers get a list per day.
 */
export function WeekGrid({
  days,
  meetings,
  today,
  className,
}: {
  days: CalendarDay[]
  meetings: ScheduleMeeting[]
  today: string
  className?: string
}) {
  const timed = meetings.filter((m) => m.time && days.some((d) => d.weekday === m.time!.day))
  const startHour = Math.min(8, ...timed.map((m) => Math.floor(toMinutes(m.time!.start) / 60)))
  const endHour = Math.max(18, ...timed.map((m) => Math.ceil(toMinutes(m.time!.end) / 60)))
  const hourCount = endHour - startHour
  const total = hourCount * 60
  const pct = (minutes: number) => `${(minutes / total) * 100}%`
  const hourLines = {
    backgroundImage: "linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
    backgroundSize: `100% calc(100% / ${hourCount})`,
  }

  return (
    /* Focusable so keyboard users can scroll it. */
    <div
      role="region"
      aria-label="Week grid"
      tabIndex={0}
      className={cn(
        "overflow-y-auto rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50 border border-black/10 bg-card shadow-[0_2px_4px_rgba(0,0,0,0.04),0_12px_32px_-8px_rgba(0,0,0,0.16)] dark:border-border dark:shadow-[0_12px_32px_-10px_rgba(0,0,0,0.6)]",
        className
      )}
    >
      <div
        className="grid min-h-full"
        style={{
          gridTemplateColumns: `4.5rem repeat(${days.length}, minmax(0, 1fr))`,
          gridTemplateRows: `auto minmax(${hourCount * MIN_PX_PER_HOUR}px, 1fr)`,
        }}
      >
        <div aria-hidden="true" className="sticky top-0 z-10 border-b border-border bg-card" />
        {days.map((day) => {
          const isToday = day.date === today
          return (
            <div
              key={day.weekday}
              className={cn(
                "sticky top-0 z-10 flex items-baseline gap-2 border-b border-l border-border bg-card px-3 py-2.5",
                isToday && "bg-[color-mix(in_oklch,var(--brand-blue)_10%,var(--card))]"
              )}
            >
              <span className={cn("text-base font-semibold", isToday && "text-brand-blue")}>{day.name.slice(0, 3)}</span>
              <span className="text-base text-muted-foreground">{day.short}</span>
              {isToday && <span className="ml-auto rounded bg-brand-blue px-1.5 py-0.5 text-xs font-semibold text-background">Today</span>}
            </div>
          )
        })}

        <div aria-hidden="true" className="relative">
          {Array.from({ length: hourCount - 1 }, (_, i) => startHour + i + 1).map((h) => (
            <span
              key={h}
              className="absolute right-2 -translate-y-1/2 text-xs text-muted-foreground"
              style={{ top: pct((h - startHour) * 60) }}
            >
              {formatTime(`${String(h).padStart(2, "0")}:00`).replace(":00", "")}
            </span>
          ))}
        </div>

        {days.map((day) => {
          const dayMeetings = meetingsOn(day.weekday, meetings)
          const { lane, count } = layoutLanes(dayMeetings)
          const isToday = day.date === today
          return (
            <section
              key={day.weekday}
              aria-label={`${day.name}, ${day.short}${isToday ? ", today" : ""}`}
              aria-current={isToday ? "date" : undefined}
              className={cn("relative border-l border-border", isToday && "bg-brand-blue/5")}
              style={hourLines}
            >
              {dayMeetings.length === 0 && <p className="sr-only">No classes</p>}
              <ol>
                {dayMeetings.map((m) => {
                  const start = toMinutes(m.time!.start) - startHour * 60
                  const length = toMinutes(m.time!.end) - toMinutes(m.time!.start)
                  return (
                    <li
                      key={m.id}
                      className="absolute px-1 py-px"
                      style={{
                        top: pct(start),
                        height: pct(length),
                        left: `${(lane.get(m.id)! / count) * 100}%`,
                        width: `${100 / count}%`,
                      }}
                    >
                      <CalendarEvent meeting={m} compact fixedHeight className="h-full text-[15px] leading-tight" />
                    </li>
                  )
                })}
              </ol>
            </section>
          )
        })}
      </div>
    </div>
  )
}
