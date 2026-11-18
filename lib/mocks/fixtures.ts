/*
 * Synthetic data only. No real students, transcripts or grades.
 */

import type { Coursework, DataFreshness, Instructor, Profile, ScheduleMeeting, SurveySubmission } from "@/lib/api/types"

/*
 * One made-up student used by every page, so the numbers agree across the
 * site: a Computer Science (B.S.) student on the 2025-2026 catalog who started
 * Fall 2025 and is in their third semester (Fall 2026). Course codes, titles,
 * credits and AP awards are real (data/catalog, data/exam_credit); the person
 * and grades are not. Keep these in sync with audit-fixtures.ts.
 *
 * Earned: 22 credits of classes + 9 of AP credit = 31, which is why they're a
 * sophomore (UF: 30-59 earned credits). In progress this term: 13 credits.
 */
export const profileFixture: Profile = {
  preferredName: "Test Student",
  classStanding: "sophomore",
  major: "computer-science",
  catalogYear: "2025-2026",
  expectedGraduation: "Spring 2029",
}

export const courseworkFixture: Coursework = {
  version: 1,
  rows: [
    { id: "row-1", courseCode: "COP3502C", grade: "A", credits: 4, term: "Fall 2025", source: "transcript", status: "confirmed" },
    { id: "row-2", courseCode: "MAC2311", grade: "B+", credits: 4, term: "Fall 2025", source: "transcript", status: "confirmed" },
    { id: "row-3", courseCode: "ENC1101", grade: "A-", credits: 3, term: "Fall 2025", source: "transcript", status: "confirmed" },
    // AP Psychology (4) and AP US History (4). UF shows exam credit without a
    // letter grade; "CR" is a placeholder until #9 decides how imports show it.
    { id: "row-4", courseCode: "PSY2012", grade: "CR", credits: 3, term: "Fall 2025", source: "exam", status: "confirmed" },
    { id: "row-5", courseCode: "AMH2010", grade: "CR", credits: 3, term: "Fall 2025", source: "exam", status: "confirmed" },
    { id: "row-6", courseCode: "AMH2020", grade: "CR", credits: 3, term: "Fall 2025", source: "exam", status: "confirmed" },
    { id: "row-7", courseCode: "COP3503C", grade: "B", credits: 4, term: "Spring 2026", source: "transcript", status: "needs-review" },
    { id: "row-8", courseCode: "MAC2312", grade: "S", credits: 4, term: "Spring 2026", source: "transcript", status: "needs-review" },
    { id: "row-9", courseCode: "CHM2045", grade: "B-", credits: 3, term: "Spring 2026", source: "manual", status: "confirmed" },
  ],
}

export const surveyFixture: SurveySubmission | null = null

/* The newest catalog the app has data for (Shaun's scrape), not the student's own catalog year. */
export const freshnessFixture: DataFreshness = {
  catalogYear: "2026-2027",
  scheduleUpdatedAt: "2026-10-04T02:21:11Z",
}

/* UF terms by the month a week starts in: Jan-Apr Spring, May-Jul Summer, Aug-Dec Fall. */
export function termFor(weekStart: string) {
  const [year, month] = weekStart.split("-").map(Number)
  const season = month <= 4 ? "Spring" : month <= 7 ? "Summer" : "Fall"
  return `${season} ${year}`
}

/*
 * This term (Fall 2026): PHY 2048 + lab, COT 3100, ENC 2210, DIG 1627 (13
 * credits). Times follow UF periods; section numbers and rooms are made up.
 * There is no real source for times yet: the SOC scraper skips meeting times
 * and rooms (they need a signed-in UF session), so students will likely enter
 * them by hand.
 */

const PHY = { courseCode: "PHY2048", title: "Physics with Calculus 1", section: "2468", online: false } as const
const COT = { courseCode: "COT3100", title: "Applications of Discrete Structures", section: "5678", online: false } as const
const ENC = { courseCode: "ENC2210", title: "Technical Writing", section: "1357", online: false } as const

/*
 * Made-up instructors and ratings. The rmpIds are fake too, so "Read reviews"
 * links in mock mode open unrelated RMP pages. Covers every rating state:
 * strong, weak, no RMP match, too few ratings, no would-take-again number.
 */
const TEACHES: Record<string, Instructor[]> = {
  PHY2048: [{ name: "Casey Placeholder", rating: { rmpId: 1000003, quality: 2.9, difficulty: 4.2, wouldTakeAgainPercent: 41, numRatings: 88 } }],
  PHY2048L: [{ name: "Morgan Demo", rating: null }],
  COT3100: [{ name: "Jordan Sample", rating: { rmpId: 1000002, quality: 4.7, difficulty: 3.1, wouldTakeAgainPercent: 92, numRatings: 210 } }],
  ENC2210: [{ name: "Avery Example", rating: { rmpId: 1000001, quality: 4.2, difficulty: 2.4, wouldTakeAgainPercent: null, numRatings: 54 } }],
  DIG1627: [{ name: "Taylor Fixture", rating: { rmpId: 1000004, quality: 3.8, difficulty: 2.1, wouldTakeAgainPercent: 70, numRatings: 2 } }],
}

const withInstructors = (m: Omit<ScheduleMeeting, "instructors">): ScheduleMeeting => ({ ...m, instructors: TEACHES[m.courseCode] ?? [] })

export const weeklyMeetingsFixture: ScheduleMeeting[] = ([
  { ...PHY, id: "m1", kind: "lecture", time: { day: "MON", start: "09:35", end: "10:25" }, location: "NPB 1001" },
  { ...PHY, id: "m2", kind: "lecture", time: { day: "WED", start: "09:35", end: "10:25" }, location: "NPB 1001" },
  { ...PHY, id: "m3", kind: "lecture", time: { day: "FRI", start: "09:35", end: "10:25" }, location: "NPB 1001" },
  { ...PHY, id: "m4", kind: "discussion", time: { day: "THU", start: "08:30", end: "09:20" }, location: "NPB 1101" },
  { ...COT, id: "m5", kind: "lecture", time: { day: "MON", start: "10:40", end: "11:30" }, location: "CSE A101" },
  { ...COT, id: "m6", kind: "lecture", time: { day: "WED", start: "10:40", end: "11:30" }, location: "CSE A101" },
  { ...COT, id: "m7", kind: "lecture", time: { day: "FRI", start: "10:40", end: "11:30" }, location: "CSE A101" },
  { ...COT, id: "m8", kind: "discussion", time: { day: "TUE", start: "12:50", end: "13:40" }, location: "CSE E115" },
  { ...ENC, id: "m9", kind: "lecture", time: { day: "MON", start: "12:50", end: "13:40" }, location: "TUR 2322" },
  { ...ENC, id: "m10", kind: "lecture", time: { day: "WED", start: "12:50", end: "13:40" }, location: "TUR 2322" },
  { ...ENC, id: "m11", kind: "lecture", time: { day: "FRI", start: "12:50", end: "13:40" }, location: "TUR 2322" },
  { id: "m12", courseCode: "PHY2048L", title: "Laboratory for PHY 2048", section: "2470", kind: "lab", time: { day: "WED", start: "15:00", end: "16:55" }, location: "NPB B110", online: false },
  { id: "m13", courseCode: "DIG1627", title: "AI & Art/Science/Fiction", section: "UFOL", kind: "lecture", time: null, location: null, online: true },
] satisfies Omit<ScheduleMeeting, "instructors">[]).map(withInstructors)

/* An evening PHY 2048 exam, only in the week starting this Monday. */
export const examWeekStart = "2026-11-16"
export const examFixture: ScheduleMeeting = withInstructors({
  ...PHY, id: "x1", kind: "exam", time: { day: "THU", start: "20:20", end: "22:10" }, location: "CAR 100",
})
