import { cn } from "cn"
import type { ScheduleMeeting } from "@/lib/api/types"
import { type CalendarDay, meetingsOn } from "@/lib/schedule"
import { CalendarEvent } from "./calendar-event"

/** The list alternative to the grid (#21), and the only view on phones. Empty days stay visible. */
export function AgendaList({ days, meetings, today }: { days: CalendarDay[]; meetings: ScheduleMeeting[]; today: string }) {
  return (
    <ol className="flex flex-col gap-5">
      {days.map((day) => {
        const dayMeetings = meetingsOn(day.weekday, meetings)
        const isToday = day.date === today
        return (
          <li key={day.weekday} aria-current={isToday ? "date" : undefined}>
            <h3 className="mb-2 flex items-baseline gap-2 text-base">
              <span className={cn("font-semibold", isToday && "text-brand-orange-text")}>{day.name}</span>
              <span className={isToday ? "text-brand-orange-text" : "text-muted-foreground"}>{day.short}</span>
              {isToday && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">Today</span>
              )}
            </h3>
            {dayMeetings.length === 0 ? (
              <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">No classes</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {dayMeetings.map((m) => (
                  <li key={m.id}>
                    <CalendarEvent meeting={m} className="text-[15px]" />
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ol>
  )
}
