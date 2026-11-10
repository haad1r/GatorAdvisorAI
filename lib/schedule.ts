import type { MeetingKind, ScheduleMeeting, Weekday } from "@/lib/api/types"

/* Display helpers for the schedule calendar. No academic logic: times come from the API as-is. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export const WEEKDAYS: Weekday[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]

const DAY_NAMES: Record<Weekday, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
}

export const KIND_LABEL: Record<MeetingKind, string> = {
  lecture: "Lecture",
  lab: "Lab",
  discussion: "Discussion",
  exam: "Exam",
}

/** "10:40" -> 640 */
export function toMinutes(time: string) {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + m
}

/** "9:35 AM – 10:25 AM" -> "9:35–10:25 AM"; keeps both suffixes when they differ. */
export function formatTimeRange(start: string, end: string) {
  const [a, b] = [formatTime(start), formatTime(end)]
  const [aTime, aSuffix] = a.split(" ")
  return aSuffix === b.split(" ")[1] ? `${aTime}–${b}` : `${a} – ${b}`
}

/** "13:40" -> "1:40 PM" */
export function formatTime(time: string) {
  const [h, m] = time.split(":").map(Number)
  const suffix = h >= 12 ? "PM" : "AM"
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`
}

/* Dates are handled as calendar days ("YYYY-MM-DD") at UTC noon, so no time zone can shift the day. */
function fromIso(iso: string) {
  return new Date(`${iso}T12:00:00Z`)
}

export function addDays(iso: string, days: number) {
  const d = fromIso(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Today's date in Gainesville, "YYYY-MM-DD". */
export function todayInGainesville(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now)
}

/** Monday on or before the given day. */
export function mondayOf(iso: string) {
  const day = fromIso(iso).getUTCDay() // 0 = Sunday
  return addDays(iso, day === 0 ? -6 : 1 - day)
}

export type CalendarDay = { weekday: Weekday; date: string; name: string; short: string }

/** Mon–Fri, plus Saturday/Sunday only when a meeting falls on them. */
export function daysToShow(weekStart: string, meetings: ScheduleMeeting[]): CalendarDay[] {
  const used = new Set(meetings.map((m) => m.time?.day))
  return WEEKDAYS.map((weekday, i) => ({ weekday, i }))
    .filter(({ weekday, i }) => i < 5 || used.has(weekday))
    .map(({ weekday, i }) => {
      const date = addDays(weekStart, i)
      return {
        weekday,
        date,
        name: DAY_NAMES[weekday],
        short: `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`,
      }
    })
}

/**
 * "Nov 9 – 13, 2026", "Nov 30 – Dec 4, 2026", or "Dec 28, 2026 – Jan 1, 2027".
 * Built by hand: Intl formatRange spacing differs between Node and browsers,
 * which breaks hydration.
 */
export function formatWeekRange(weekStart: string, days = 5) {
  const [y1, m1, d1] = weekStart.split("-").map(Number)
  const [y2, m2, d2] = addDays(weekStart, days - 1).split("-").map(Number)
  if (y1 !== y2) return `${MONTHS[m1 - 1]} ${d1}, ${y1} – ${MONTHS[m2 - 1]} ${d2}, ${y2}`
  if (m1 !== m2) return `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}, ${y2}`
  return `${MONTHS[m1 - 1]} ${d1} – ${d2}, ${y2}`
}

export function meetingsOn(day: Weekday, meetings: ScheduleMeeting[]) {
  return meetings
    .filter((m) => m.time?.day === day)
    .sort((a, b) => toMinutes(a.time!.start) - toMinutes(b.time!.start))
}

/**
 * Side-by-side lanes for overlapping meetings on one day. Each meeting gets
 * the first lane that is free at its start; all share the day's lane count.
 */
export function layoutLanes(dayMeetings: ScheduleMeeting[]) {
  const laneEnds: number[] = []
  const lane = new Map<string, number>()
  for (const m of dayMeetings) {
    const start = toMinutes(m.time!.start)
    let i = laneEnds.findIndex((end) => end <= start)
    if (i === -1) i = laneEnds.push(0) - 1
    laneEnds[i] = toMinutes(m.time!.end)
    lane.set(m.id, i)
  }
  return { lane, count: Math.max(1, laneEnds.length) }
}

export function unscheduled(meetings: ScheduleMeeting[]) {
  return meetings.filter((m) => !m.time)
}

/** Full sentence for screen readers, e.g. "COP3503 lecture, Monday 10:40 AM to 11:30 AM, CSE A101". */
export function meetingLabel(m: ScheduleMeeting) {
  const what = `${m.courseCode} ${KIND_LABEL[m.kind].toLowerCase()}`
  if (!m.time) return `${what}, ${m.online ? "online, no set meeting time" : "time to be announced"}`
  const when = `${DAY_NAMES[m.time.day]} ${formatTime(m.time.start)} to ${formatTime(m.time.end)}`
  return `${what}, ${when}, ${m.location ?? (m.online ? "online" : "location to be announced")}`
}
