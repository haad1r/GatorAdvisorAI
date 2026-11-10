import type { ScheduleMeeting } from "@/lib/api/types"
import { CalendarEvent } from "./calendar-event"

/** TBA and asynchronous meetings: listed, never placed at an invented time (#21). */
export function UnscheduledList({ meetings }: { meetings: ScheduleMeeting[] }) {
  if (meetings.length === 0) return null
  return (
    <section aria-labelledby="unscheduled-heading" className="flex shrink-0 flex-col gap-2">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span id="unscheduled-heading" role="heading" aria-level={2} className="text-base font-semibold">
          Not on the calendar
        </span>
        <span className="text-sm text-muted-foreground">No set meeting time yet, or online without one.</span>
      </p>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {meetings.map((m) => (
          <li key={m.id}>
            <CalendarEvent meeting={m} compact className="text-[15px]" />
          </li>
        ))}
      </ul>
    </section>
  )
}
