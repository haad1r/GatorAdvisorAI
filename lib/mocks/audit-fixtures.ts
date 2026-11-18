/*
 * Synthetic audit and tracking for the mock student in fixtures.ts (a
 * Computer Science B.S. sophomore). Requirement groups and tracking
 * milestones follow Shaun's scrape of the CS program page
 * (data/programs/requirements.csv, milestones.csv); the results are made up
 * and were not produced by an engine. Deliberately includes an unknown, a
 * course counted twice, and an at-risk deadline so every UI state shows up.
 */

import type {
  CountedCourse,
  DegreeAudit,
  RequirementResult,
  SourceReference,
  TrackingMilestone,
  TrackingResult,
} from "@/lib/api/types"

const CATALOG: SourceReference = {
  label: "UF Catalog: Computer Science (B.S.)",
  url: "https://catalog.ufl.edu/UGRD/colleges-schools/UGLAS/CSC_BS/",
  fetchedAt: "2026-10-04T01:40:28Z",
}

const GEN_ED: SourceReference = {
  label: "UF Catalog: General Education",
  url: "https://catalog.ufl.edu/UGRD/academic-programs/general-education/",
  fetchedAt: "2026-10-04T01:40:28Z",
}

const done = (courseCode: string, grade: string, credits: number, term: string): CountedCourse => ({
  courseCode,
  grade,
  credits,
  term,
  source: "transcript",
  inProgress: false,
})

const current = (courseCode: string, credits: number): CountedCourse => ({
  courseCode,
  grade: null,
  credits,
  term: "Fall 2026",
  source: "transcript",
  inProgress: true,
})

const req = (r: Omit<RequirementResult, "sources"> & { sources?: SourceReference[] }): RequirementResult => ({
  sources: [r.category === "gen_ed" ? GEN_ED : CATALOG],
  ...r,
})

const requirements: RequirementResult[] = [
  req({
    id: "required-foundational-coursework",
    category: "major",
    title: "Foundational writing",
    status: "not_met",
    needed: { credits: 3, courses: 1 },
    earned: { credits: 0, courses: 0 },
    counted: [],
    stillToTake: ["One of ENC 3246, ENC 2210, ENC 2256"],
    reason: "None of the listed writing courses is on your record.",
  }),
  req({
    id: "required-foundational-coursework-2",
    category: "major",
    title: "Foundational math",
    status: "unknown",
    needed: { credits: 15, courses: 4 },
    earned: { credits: 4, courses: 1 },
    counted: [done("MAC2311", "B+", 4, "Fall 2025")],
    stillToTake: ["MAC 2313", "MAS 4105 or MAS 3114"],
    reason: "MAC 2312 has an S grade. The catalog requires a C or better and doesn't say whether S counts.",
  }),
  req({
    id: "select-one",
    category: "major",
    title: "Physics 1 with lab",
    status: "in_progress",
    needed: { credits: 4, courses: 1 },
    earned: { credits: 0, courses: 0 },
    counted: [current("PHY2048", 3), current("PHY2048L", 1)],
    stillToTake: [],
    reason: "PHY 2048 and PHY 2048L are in progress this term.",
  }),
  req({
    id: "select-one-2",
    category: "major",
    title: "Physics 2 with lab",
    status: "not_met",
    needed: { credits: 4, courses: 1 },
    earned: { credits: 0, courses: 0 },
    counted: [],
    stillToTake: ["PHY 2049 and PHY 2049L, or PHY 2054 and PHY 2054L"],
    reason: "No second physics course on your record.",
  }),
  req({
    id: "required-foundational-coursework-3",
    category: "major",
    title: "Statistics",
    status: "not_met",
    needed: { credits: 3, courses: 1 },
    earned: { credits: 0, courses: 0 },
    counted: [],
    stillToTake: ["STA 3032"],
    reason: "STA 3032 not yet taken.",
  }),
  req({
    id: "required-computing-core-coursework",
    category: "major",
    title: "Computing core",
    status: "in_progress",
    needed: { credits: 14, courses: 4 },
    earned: { credits: 6, courses: 2 },
    counted: [done("COP3502", "A", 3, "Fall 2025"), done("COP3503", "B", 3, "Spring 2026")],
    stillToTake: ["COT 3100", "COP 3530"],
    reason: "2 of 4 courses done.",
  }),
  req({
    id: "required-major-core-coursework",
    category: "major",
    title: "Major core",
    status: "not_met",
    needed: { credits: null, courses: 7 },
    earned: { credits: 0, courses: 0 },
    counted: [],
    stillToTake: ["CDA 3101", "CEN 3031", "CIS 4301", "CIS 4914 or EGN 4952", "COP 4020", "COP 4533", "COP 4600"],
    reason: "None of the 7 major core courses taken yet.",
  }),
  req({
    id: "required-major-electives",
    category: "major",
    title: "Major electives",
    status: "not_met",
    needed: { credits: 9, courses: null },
    earned: { credits: 0, courses: 0 },
    counted: [],
    stillToTake: ["9 credits from the approved list or any 4000-level CISE course"],
    reason: "No electives taken yet.",
  }),
  req({
    id: "gened-composition",
    category: "gen_ed",
    title: "Composition (C)",
    status: "met",
    needed: { credits: 3, courses: null },
    earned: { credits: 3, courses: 1 },
    counted: [done("ENC1101", "A-", 3, "Fall 2025")],
    stillToTake: [],
    reason: "ENC 1101 counts.",
  }),
  req({
    id: "gened-natural_science",
    category: "gen_ed",
    title: "Natural sciences (B/P)",
    status: "in_progress",
    needed: { credits: 9, courses: null },
    earned: { credits: 3, courses: 1 },
    counted: [done("CHM2045", "B-", 3, "Spring 2026"), current("PHY2048", 3)],
    stillToTake: ["3 more credits of B or P courses"],
    reason: "CHM 2045 counts; PHY 2048 will count once finished.",
  }),
  req({
    id: "gened-humanities",
    category: "gen_ed",
    title: "Humanities (H)",
    status: "not_met",
    needed: { credits: 9, courses: null },
    earned: { credits: 0, courses: 0 },
    counted: [],
    stillToTake: ["9 credits of H courses"],
    reason: "No humanities courses yet.",
  }),
  req({
    id: "gened-social",
    category: "gen_ed",
    title: "Social and behavioral sciences (S)",
    status: "not_met",
    needed: { credits: 9, courses: null },
    earned: { credits: 0, courses: 0 },
    counted: [],
    stillToTake: ["9 credits of S courses"],
    reason: "No social science courses yet.",
  }),
  req({
    id: "gened-quest1",
    category: "gen_ed",
    title: "Quest 1",
    status: "not_met",
    needed: { credits: 3, courses: 1 },
    earned: { credits: 0, courses: 0 },
    counted: [],
    stillToTake: ["One Quest 1 course"],
    reason: "No Quest 1 course yet.",
  }),
  req({
    id: "gened-quest2",
    category: "gen_ed",
    title: "Quest 2",
    status: "not_met",
    needed: { credits: 3, courses: 1 },
    earned: { credits: 0, courses: 0 },
    counted: [],
    stillToTake: ["One Quest 2 course"],
    reason: "No Quest 2 course yet.",
  }),
  req({
    id: "clas-foreign-language",
    category: "gen_ed",
    title: "Foreign language (CLAS)",
    status: "unknown",
    needed: { credits: null, courses: null },
    earned: { credits: 0, courses: 0 },
    counted: [],
    stillToTake: ["Two years of one language in high school, or the second course of a language at UF"],
    reason: "High school language credit can meet this, and we don't have your high school record.",
    sources: [CATALOG],
  }),
]

export const auditFixture: DegreeAudit = {
  program: { id: "uglas-csc_bs", name: "Computer Science (B.S.)", catalogYear: "2025-2026" },
  recordVersion: 1,
  generatedAt: "2026-11-17T14:00:00Z",
  credits: { earned: 20, inProgress: 4, required: 120, remaining: 96 },
  percentComplete: 17,
  gpa: [
    { kind: "overall", value: 3.33 },
    { kind: "major", value: 3.5 },
    { kind: "upper_division", value: null, note: "No 3000-level or higher courses graded yet." },
  ],
  requirements,
  sharedCourses: [{ courseCode: "PHY2048", requirementIds: ["select-one", "gened-natural_science"] }],
  unknowns: [
    { requirementId: "required-foundational-coursework-2", message: "Whether an S grade in MAC 2312 meets the C-or-better rule." },
    { requirementId: "clas-foreign-language", message: "Whether high school language credit covers the foreign language requirement." },
  ],
}

const milestone = (m: Omit<TrackingMilestone, "sources">): TrackingMilestone => ({ ...m, sources: [CATALOG] })

const milestones: TrackingMilestone[] = [
  milestone({ id: "ct-1", semester: 1, description: "Complete MAC 1147 or MAC 2311", deadlineTerm: "Fall 2025", status: "met", reason: "MAC 2311 completed Fall 2025 (B+)." }),
  milestone({ id: "ct-2", semester: 2, description: "Complete MAC 2311", deadlineTerm: "Spring 2026", status: "met", reason: "MAC 2311 completed Fall 2025 (B+)." }),
  milestone({ id: "ct-3", semester: 3, description: "Complete MAC 2312", deadlineTerm: "Fall 2026", status: "unknown", reason: "MAC 2312 has an S grade; tracking needs a C or better." }),
  milestone({ id: "ct-4", semester: 4, description: "Complete MAC 2313, and PHY 2048/2048L or PHY 2053/2053L", deadlineTerm: "Spring 2027", status: "at_risk", reason: "MAC 2313 isn't on your record or in progress, and it's due by the end of Spring 2027." }),
  milestone({ id: "ct-5", semester: 5, description: "Complete COP 3502C or COP 3504C, and PHY 2049/2049L or PHY 2054/2054L", deadlineTerm: "Fall 2027", status: "not_met", reason: "COP 3502C is done; second physics isn't taken yet." }),
  milestone({ id: "ct-6", semester: 6, description: "Complete COP 3503C or COP 3504C, and COT 3100", deadlineTerm: "Spring 2028", status: "not_met", reason: "COP 3503C is done; COT 3100 isn't taken yet." }),
  milestone({ id: "ct-7", semester: 7, description: "Complete COP 3530", deadlineTerm: "Fall 2028", status: "not_met", reason: "COP 3530 not yet taken." }),
  milestone({ id: "ct-8", semester: 8, description: "Complete COP 4600", deadlineTerm: "Spring 2029", status: "not_met", reason: "COP 4600 not yet taken." }),
]

export const trackingFixture: TrackingResult = {
  milestones,
  nextDeadline: milestones[2],
}
