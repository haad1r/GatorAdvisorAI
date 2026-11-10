import { CalendarEvent } from "@/components/calendar/calendar-event"
import { WeekGrid } from "@/components/calendar/week-grid"
import type { ScheduleMeeting } from "@/lib/api/types"
import { daysToShow } from "@/lib/schedule"

const base = { title: "Example course", section: "0000", online: false }

const KINDS: ScheduleMeeting[] = [
  { ...base, id: "p1", courseCode: "COP3503", kind: "lecture", time: { day: "MON", start: "10:40", end: "11:30" }, location: "CSE A101" },
  { ...base, id: "p2", courseCode: "MAC2312", kind: "discussion", time: { day: "THU", start: "08:30", end: "09:20" }, location: "LIT 201" },
  { ...base, id: "p3", courseCode: "PHY2048L", kind: "lab", time: { day: "WED", start: "15:00", end: "16:55" }, location: "NPB B110" },
  { ...base, id: "p4", courseCode: "MAC2312", kind: "exam", time: { day: "THU", start: "20:20", end: "22:10" }, location: "CAR 100" },
  { ...base, id: "p5", courseCode: "CHM2045", kind: "lecture", time: null, location: null, online: true },
  { ...base, id: "p6", courseCode: "IDS2935", kind: "lecture", time: null, location: null },
]

/* Two meetings that clash on Tuesday, to show side-by-side lanes. */
const CLASH: ScheduleMeeting[] = [
  { ...base, id: "c1", courseCode: "PHY2048", kind: "lecture", time: { day: "TUE", start: "11:45", end: "13:40" }, location: "NPB 1001" },
  { ...base, id: "c2", courseCode: "COP3503", kind: "discussion", time: { day: "TUE", start: "12:50", end: "13:40" }, location: "CSE E115" },
  { ...base, id: "c3", courseCode: "MAC2312", kind: "lecture", time: { day: "WED", start: "09:35", end: "10:25" }, location: "LIT 109" },
]

export function CalendarDemo() {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Calendar event</h2>
      <p className="text-sm text-muted-foreground">
        Each kind shows its name as text; color only reinforces it. Online and TBA meetings never get a time.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {KINDS.map((m) => (
          <li key={m.id}>
            <CalendarEvent meeting={m} className="text-sm" />
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">Overlapping meetings sit side by side:</p>
      <div role="region" aria-label="Overlapping meetings example" tabIndex={0} className="overflow-x-auto rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <div className="min-w-[32rem]">
          <WeekGrid days={daysToShow("2026-11-09", CLASH)} meetings={CLASH} today="" className="h-[28rem]" />
        </div>
      </div>
    </section>
  )
}
