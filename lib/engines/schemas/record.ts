import { z } from "zod";
import { CatalogYear, CourseId, ProgramId, SemVer, Term, compareTerms } from "./common";

/**
 * AcademicRecord: everything the engine knows about one student, as FACTS.
 * Nothing planned or hypothetical lives here; plans and what-if scenarios are
 * separate inputs, so evaluating them can never change the saved record.
 *
 * Maria's persistence layer will own storage and `recordVersion`; this schema
 * is the shape the engine accepts, whoever builds it (database, transcript
 * import, a test).
 */

/** UF grade symbols, from the catalog's grading policy:
 *  https://catalog.ufl.edu/UGRD/academic-regulations/grades-grading-policies/
 *  (read 2026-10-25). Counted in the UF GPA: A through E, plus WF, I and NG
 *  (each 0 points). Not counted: S, U, W, H, I*, N*. "A grade of S is equal to
 *  a C (2.0) or better." Repeats: every recorded grade counts in the GPA, but
 *  credit is awarded only once. Transfer grades are never averaged into it. */
export const Grade = z.enum([
  "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "E",
  "WF", "I", "NG",
  "S", "U", "W", "H", "I*", "N*",
]);
export type Grade = z.infer<typeof Grade>;

/** One ATTEMPT at a course. A repeat is a second attempt with its own row,
 *  never an edit of the first: UF counts both grades in the GPA, so the engine
 *  needs both. */
export const CourseAttempt = z
  .strictObject({
    /** Unique within the record; results cite it as evidence. */
    attemptId: z.string().min(1),
    courseId: CourseId,
    /** completed: the term is over (the grade may still be missing).
     *  in_progress: enrolled in the record's current term, no grade yet.
     *  A withdrawal is completed with grade W. */
    status: z.enum(["completed", "in_progress"]),
    grade: Grade.optional(),
    /** Hours on THIS attempt as the transcript shows them. A transfer course
     *  keeps the sending institution's hours even when UF's equivalent has
     *  more (FIU's 3-credit ECO 2013 still meets UF's 4-credit ECO 2013). */
    credits: z.number().nonnegative(),
    source: z.enum(["uf", "transfer", "dual_enrollment"]),
    /** Required for UF attempts; a transfer row may not say when. */
    term: Term.optional(),
    institution: z.string().optional(),
    /** The course as the sending institution listed it ("ENC1101 at SFC"). */
    originalCode: z.string().optional(),
  })
  .superRefine((a, ctx) => {
    if (a.status === "in_progress" && a.grade)
      ctx.addIssue({ code: "custom", path: ["grade"], message: "an in-progress attempt has no grade yet" });
    if (a.source === "uf" && !a.term)
      ctx.addIssue({ code: "custom", path: ["term"], message: "a UF attempt needs its term" });
    if (a.source !== "uf" && !a.institution)
      ctx.addIssue({ code: "custom", path: ["institution"], message: "a transfer attempt needs its institution" });
  });
export type CourseAttempt = z.infer<typeof CourseAttempt>;

/** Credit from an exam (AP, IB, AICE, CLEP, ...). Records what UF granted;
 *  `awardId` ties it to the row of data/exam_credit/awards.csv it came from. */
export const ExamCredit = z.strictObject({
  examCreditId: z.string().min(1),
  awardId: z.string().min(1),
  score: z.number(),
  courseIds: z.array(CourseId),
  credits: z.number().nonnegative(),
});
export type ExamCredit = z.infer<typeof ExamCredit>;

/** Credit with no UF course equivalent: UF's elective placeholders
 *  (L000/U000/T000 codes), or anything else that counts as hours only. It
 *  counts toward total credits and nothing else. */
export const ElectiveCredit = z.strictObject({
  entryId: z.string().min(1),
  label: z.string().min(1),
  credits: z.number().nonnegative(),
  source: z.enum(["transfer", "dual_enrollment", "exam"]),
  institution: z.string().optional(),
});
export type ElectiveCredit = z.infer<typeof ElectiveCredit>;

/** Advisor-approved exceptions. They are explicit records, never inferred:
 *  the engine applies only what is written here. */
export const RecordException = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("substitution"),
    exceptionId: z.string().min(1),
    programId: ProgramId,
    requirementKey: z.string().min(1),
    /** The course that counts instead. */
    courseId: CourseId,
    /** The course it stands in for, when the substitution names one. */
    replacesCourseId: CourseId.optional(),
    note: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("waiver"),
    exceptionId: z.string().min(1),
    programId: ProgramId,
    requirementKey: z.string().min(1),
    note: z.string().min(1),
  }),
  z.strictObject({
    /** Lets one course count toward requirements that would otherwise each
     *  need their own course. */
    kind: z.literal("allow_overlap"),
    exceptionId: z.string().min(1),
    courseId: CourseId,
    requirements: z
      .array(z.strictObject({ programId: ProgramId, requirementKey: z.string().min(1) }))
      .min(2),
    note: z.string().min(1),
  }),
]);
export type RecordException = z.infer<typeof RecordException>;

export const DeclaredProgram = z.strictObject({
  programId: ProgramId,
  /** Defaults to the record's catalogYear when absent. */
  catalogYear: CatalogYear.optional(),
});

/** Yes/no facts a requirement can depend on. ABSENT means "not known", which
 *  the engine reports as unknown (missing_input); false means "known not". */
export const RecordFacts = z.strictObject({
  /** Florida AA degree (waives UF general education: `waived_by`
   *  "aa_or_60_credits" in the data). */
  hasFloridaAA: z.boolean().optional(),
  /** Foreign-language proficiency by placement or prior study
   *  (`waived_by` "language_placement_or_proficiency"). */
  languageProficiency: z.boolean().optional(),
});

export const AcademicRecord = z
  .strictObject({
    contractVersion: SemVer,
    /** Opaque id; never a name, email or UFID. */
    recordId: z.string().min(1),
    /** Changes whenever the record changes. Results quote it. */
    recordVersion: z.string().min(1),
    /** The catalog year the student is held to. */
    catalogYear: CatalogYear,
    /** The term "now" is, for this record. The engine never reads the clock:
     *  the same record gives the same answer whenever it is evaluated. */
    currentTerm: Term,
    /** First term of college enrollment, for counting enrolled semesters
     *  (Critical Tracking). A transfer student's first term is at the
     *  previous institution. After currentTerm for an admitted student who
     *  hasn't started (semester 0: nothing is due yet). */
    firstTerm: Term,
    programs: z.array(DeclaredProgram),
    attempts: z.array(CourseAttempt),
    examCredits: z.array(ExamCredit),
    electiveCredits: z.array(ElectiveCredit),
    exceptions: z.array(RecordException),
    facts: RecordFacts,
  })
  .superRefine((r, ctx) => {
    // One id space for every entry, because results cite them all the same way.
    const entries = [
      ...r.attempts.map((a, i) => ({ id: a.attemptId, path: ["attempts", i, "attemptId"] })),
      ...r.examCredits.map((e, i) => ({ id: e.examCreditId, path: ["examCredits", i, "examCreditId"] })),
      ...r.electiveCredits.map((e, i) => ({ id: e.entryId, path: ["electiveCredits", i, "entryId"] })),
      ...r.exceptions.map((e, i) => ({ id: e.exceptionId, path: ["exceptions", i, "exceptionId"] })),
    ];
    const ids = new Set<string>();
    for (const { id, path } of entries) {
      if (ids.has(id)) ctx.addIssue({ code: "custom", path, message: `duplicate entry id "${id}"` });
      ids.add(id);
    }
    if (compareTerms(r.firstTerm, r.currentTerm) > 0 && r.attempts.some((a) => a.term && compareTerms(a.term, r.firstTerm) >= 0))
      ctx.addIssue({ code: "custom", path: ["firstTerm"], message: "a student who hasn't started (firstTerm after currentTerm) has no UF attempts yet" });
    r.attempts.forEach((a, i) => {
      if (!a.term) return;
      const order = compareTerms(a.term, r.currentTerm);
      if (a.status === "in_progress" && order !== 0)
        ctx.addIssue({ code: "custom", path: ["attempts", i, "term"], message: "an in-progress attempt must be in currentTerm" });
      if (a.status === "completed" && order >= 0)
        ctx.addIssue({ code: "custom", path: ["attempts", i, "term"], message: "a completed attempt must be before currentTerm" });
    });
  });
export type AcademicRecord = z.infer<typeof AcademicRecord>;
