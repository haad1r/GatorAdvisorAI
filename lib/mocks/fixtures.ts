/*
 * Synthetic data only. No real students, transcripts or grades.
 */

import type { Coursework, Profile, SurveySubmission } from "@/lib/api/types"

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
