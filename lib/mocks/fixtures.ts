/*
 * Synthetic data only. No real students, transcripts or grades.
 */

import type { Coursework, DataFreshness, Instructor, Profile, ScheduleMeeting, SurveySubmission } from "@/lib/api/types"

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
    { id: "row-1", courseCode: "COP3502", grade: "A", credits: 3, term: "Fall 2025", source: "transcript", status: "confirmed" },
    { id: "row-2", courseCode: "MAC2311", grade: "B+", credits: 4, term: "Fall 2025", source: "transcript", status: "confirmed" },
    { id: "row-3", courseCode: "ENC1101", grade: "A-", credits: 3, term: "Fall 2025", source: "transcript", status: "confirmed" },
    { id: "row-4", courseCode: "COP3503", grade: "B", credits: 3, term: "Spring 2026", source: "transcript", status: "needs-review" },
    { id: "row-5", courseCode: "MAC2312", grade: "S", credits: 4, term: "Spring 2026", source: "transcript", status: "needs-review" },
    { id: "row-6", courseCode: "CHM2045", grade: "B-", credits: 3, term: "Spring 2026", source: "manual", status: "confirmed" },
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
 * Synthetic schedule. Times follow UF periods; rooms are made up. There is no
 * real source yet: the SOC scraper skips meeting times and rooms (they need a
 * signed-in UF session), so students will likely enter them by hand.
 */

/*
 * Made-up instructors and ratings. The rmpIds are fake too, so "Read reviews"
 * links in mock mode open unrelated RMP pages.
 */
const TEACHES: Record<string, Instructor[]> = {
  MAC2312: [{ name: "Avery Example", rating: { rmpId: 1000001, quality: 4.2, difficulty: 3.6, wouldTakeAgainPercent: 78, numRatings: 54 } }],
  COP3503: [{ name: "Jordan Sample", rating: { rmpId: 1000002, quality: 4.7, difficulty: 3.1, wouldTakeAgainPercent: 92, numRatings: 210 } }],
  PHY2048: [{ name: "Casey Placeholder", rating: { rmpId: 1000003, quality: 2.9, difficulty: 4.2, wouldTakeAgainPercent: 41, numRatings: 88 } }],
  PHY2048L: [{ name: "Morgan Demo", rating: null }],
  CHM2045: [{ name: "Taylor Fixture", rating: { rmpId: 1000004, quality: 3.8, difficulty: 3.3, wouldTakeAgainPercent: null, numRatings: 2 } }],
  IDS2935: [],
}

const withInstructors = (m: Omit<ScheduleMeeting, "instructors">): ScheduleMeeting => ({ ...m, instructors: TEACHES[m.courseCode] ?? [] })

export const weeklyMeetingsFixture: ScheduleMeeting[] = ([
  { id: "m1", courseCode: "MAC2312", title: "Analytic Geometry and Calculus 2", section: "1234", kind: "lecture", time: { day: "MON", start: "09:35", end: "10:25" }, location: "LIT 109", online: false },
  { id: "m2", courseCode: "MAC2312", title: "Analytic Geometry and Calculus 2", section: "1234", kind: "lecture", time: { day: "WED", start: "09:35", end: "10:25" }, location: "LIT 109", online: false },
  { id: "m3", courseCode: "MAC2312", title: "Analytic Geometry and Calculus 2", section: "1234", kind: "lecture", time: { day: "FRI", start: "09:35", end: "10:25" }, location: "LIT 109", online: false },
  { id: "m4", courseCode: "MAC2312", title: "Analytic Geometry and Calculus 2", section: "1234", kind: "discussion", time: { day: "THU", start: "08:30", end: "09:20" }, location: "LIT 201", online: false },
  { id: "m5", courseCode: "COP3503", title: "Programming Fundamentals 2", section: "5678", kind: "lecture", time: { day: "MON", start: "10:40", end: "11:30" }, location: "CSE A101", online: false },
  { id: "m6", courseCode: "COP3503", title: "Programming Fundamentals 2", section: "5678", kind: "lecture", time: { day: "WED", start: "10:40", end: "11:30" }, location: "CSE A101", online: false },
  { id: "m7", courseCode: "COP3503", title: "Programming Fundamentals 2", section: "5678", kind: "lecture", time: { day: "FRI", start: "10:40", end: "11:30" }, location: "CSE A101", online: false },
  { id: "m8", courseCode: "COP3503", title: "Programming Fundamentals 2", section: "5678", kind: "discussion", time: { day: "TUE", start: "12:50", end: "13:40" }, location: "CSE E115", online: false },
  { id: "m9", courseCode: "PHY2048", title: "Physics with Calculus 1", section: "2468", kind: "lecture", time: { day: "TUE", start: "11:45", end: "12:35" }, location: "NPB 1001", online: false },
  { id: "m10", courseCode: "PHY2048", title: "Physics with Calculus 1", section: "2468", kind: "lecture", time: { day: "THU", start: "11:45", end: "12:35" }, location: "NPB 1001", online: false },
  { id: "m11", courseCode: "PHY2048L", title: "Physics with Calculus 1 Lab", section: "1357", kind: "lab", time: { day: "WED", start: "15:00", end: "16:55" }, location: "NPB B110", online: false },
  { id: "m12", courseCode: "CHM2045", title: "General Chemistry 1", section: "9999", kind: "lecture", time: null, location: null, online: true },
  { id: "m13", courseCode: "IDS2935", title: "Quest 1 (section TBA)", section: "TBA", kind: "lecture", time: null, location: null, online: false },
] satisfies Omit<ScheduleMeeting, "instructors">[]).map(withInstructors)

/* A dated evening exam, only in the week starting this Monday. */
export const examWeekStart = "2026-11-09"
export const examFixture: ScheduleMeeting = withInstructors({
  id: "x1", courseCode: "MAC2312", title: "Analytic Geometry and Calculus 2", section: "1234", kind: "exam",
  time: { day: "THU", start: "20:20", end: "22:10" }, location: "CAR 100", online: false,
})
