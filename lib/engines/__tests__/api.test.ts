import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAcademicEngine, toScoringFlags } from "..";
import { loadCatalog } from "../catalog/load";
import { CourseHistory } from "../history";
import { offeringOf } from "../offering";
import {
  AcademicRecord,
  CourseFlags,
  nextRegularTerm,
  parseCourseId,
  type Term,
  termCode,
  termOfCode,
  toCourseId,
  toDisplayCode,
} from "../schemas";
import { semesterTerm } from "../tracking";

/**
 * The public API (lib/engines/index.ts) against the synthetic student
 * (examples/record.json): Psychology BS01 + Geology minor, Fall 2026,
 * semester 3. Expected values are worked by hand from the record and the
 * catalog data, as each comment says.
 */

const catalog = loadCatalog(join(__dirname, "..", "..", "..", "data"));
const json = JSON.parse(readFileSync(join(__dirname, "..", "examples", "record.json"), "utf8"));
const record = AcademicRecord.parse(json);
const engine = createAcademicEngine(catalog);
const SPRING_2027: Term = { season: "spring", year: 2027 };
const GEOLOGY = "uglas-gly_umn";
const PSY = "uglas-psy_bs01";

const withRecord = (edit: (r: AcademicRecord) => void): AcademicRecord => {
  const r = structuredClone(record);
  edit(r);
  return AcademicRecord.parse(r);
};

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

describe("course ids: one converter", () => {
  it("accepts every spelling and keeps the suffix letter", () => {
    for (const s of ["COP 3502C", "COP3502C", "cop 3502c", "cop3502c", " Cop  3502c "]) expect(toCourseId(s)).toBe("cop3502c");
    expect(toCourseId("STA 3100")).toBe("sta3100");
    expect(toCourseId("CHM 2045L")).not.toBe(toCourseId("CHM 2045"));
    expect(toDisplayCode("cop3502c")).toBe("COP 3502C");
  });

  it("rejects text that isn't a course code", () => {
    for (const s of ["COP 350", "COPP 3502", "3502C", "", "COP 3502CL"]) expect(parseCourseId(s)).toBeNull();
    expect(() => toCourseId("STATS")).toThrow(RangeError);
  });
});

describe("terms", () => {
  it("converts Schedule of Courses codes both ways", () => {
    expect(termCode(SPRING_2027)).toBe("2271");
    expect(termCode({ season: "fall", year: 2021 })).toBe("2218");
    expect(termOfCode("2265")).toEqual({ season: "summer", year: 2026 });
    for (const t of catalog.schedule.terms) expect(termCode(t.term)).toBe(t.code);
  });

  it("'next semester' skips summer", () => {
    expect(nextRegularTerm({ season: "fall", year: 2026 })).toEqual(SPRING_2027);
    expect(nextRegularTerm({ season: "spring", year: 2027 })).toEqual({ season: "fall", year: 2027 });
    expect(nextRegularTerm({ season: "summer", year: 2027 })).toEqual({ season: "fall", year: 2027 });
  });

  it("maps enrolled semesters to calendar terms", () => {
    // fall 2025 = 1, spring 2026 = 2, fall 2026 = 3, ..., spring 2029 = 8
    expect(semesterTerm(record.firstTerm, 3)).toEqual({ season: "fall", year: 2026 });
    expect(semesterTerm(record.firstTerm, 8)).toEqual({ season: "spring", year: 2029 });
    // A summer start: the following fall is semester 1.
    expect(semesterTerm({ season: "summer", year: 2026 }, 1)).toEqual({ season: "fall", year: 2026 });
  });
});

describe("offerings", () => {
  // GLY 3105C has fall sections only; PSY 2012 runs every fall and spring.
  it("a published term is a fact: confirmed or not scheduled", () => {
    expect(offeringOf(catalog, "psy2012", SPRING_2027).status).toBe("confirmed");
    const gly = offeringOf(catalog, "gly3105c", SPRING_2027);
    expect(gly.status).toBe("not_scheduled");
    expect(gly.message).toMatch(/as read on 2026-10-04/); // Spring 2027 isn't closed
  });

  it("a future term is only an inference from past terms of that season", () => {
    const fall = offeringOf(catalog, "gly3105c", { season: "fall", year: 2027 });
    expect(fall.status).toBe("historical");
    expect(fall.seenInSeason[0]).toEqual({ season: "fall", year: 2026 });
    expect(offeringOf(catalog, "gly3105c", { season: "spring", year: 2028 }).status).toBe("not_seen");
  });

  it("a partly read term can only confirm", () => {
    // Spring 2022 (2221) stopped part-way on UF's HTTP 500.
    expect(catalog.schedule.terms.find((t) => t.code === "2221")!.complete).toBe(false);
    expect(offeringOf(catalog, "gly3105c", { season: "spring", year: 2022 }).status).toBe("unknown");
  });
});

describe("eligibility: already taken, offered, default term", () => {
  const taken = (code: string) => new CourseHistory(record, catalog).taken(toCourseId(code));

  it("reports what the record holds", () => {
    // D (a04) then B (a07): with no minimum grade a D passes at UF, so both count.
    expect(taken("BSC 2010")).toEqual({ status: "passed", evidenceIds: ["a04", "a07"] });
    expect(taken("GLY 3202C")).toEqual({ status: "in_progress", evidenceIds: ["a10"] });
    expect(taken("GLY 1102")).toEqual({ status: "not_passed", evidenceIds: ["a08"] }); // W
    expect(taken("MAC 2311")).toEqual({ status: "passed", evidenceIds: ["e01"] }); // AP credit
    expect(taken("CHM 2045")).toEqual({ status: "none", evidenceIds: [] });
    const noGrade = withRecord((r) => r.attempts.push({ attemptId: "a99", courseId: "chm2045", status: "completed", credits: 3, source: "uf", term: { season: "spring", year: 2026 } }));
    expect(new CourseHistory(noGrade, catalog).taken("chm2045").status).toBe("no_grade");
  });

  it("defaults to the next fall/spring term and accepts any spelling", () => {
    const e = engine.eligibility(json, "GLY 4043");
    expect(e.term).toEqual(SPRING_2027);
    expect(e.status).toBe("eligible_pending"); // GLY 3202C in progress
    expect(e.offering.term).toEqual(SPRING_2027);
  });

  it("never lets taken or offering change the requisite status", () => {
    const e = engine.eligibility(json, "gly3105c", SPRING_2027);
    expect(e.status).toBe("eligible"); // GLY 2010C passed
    expect(e.offering.status).toBe("not_scheduled");
  });

  it("validates the record at the boundary", () => {
    expect(() => engine.eligibility({ ...json, currentTerm: "fall 2026" }, "GLY 4043")).toThrow(/currentTerm/);
  });
});

describe("audit(student)", () => {
  const a = engine.audit(json);

  it("audits every declared program, in record order", () => {
    expect(a.programs.map((p) => p.programId)).toEqual([PSY, GEOLOGY]);
  });

  it("counts earned credit once per course, apart from current enrollment", () => {
    // Earned: PSY 2012 3, GLY 2010C 4, ENC 1101 3, BSC 2010 3 (D then B:
    // credit once), GLY 2100C 4, STA 2023 3, GLY 1150L 1, ENC 1102 3 (dual
    // enrollment), MAC 2311 4 (AP) = 28, plus 3 elective credit = 31. The W
    // in GLY 1102 earns nothing. In progress: four 3-credit courses = 12.
    expect(a.credits).toEqual({ earned: 31, inProgress: 12 });
  });

  it("labels every GPA and computes only the one a source defines", () => {
    expect(a.gpa.map((g) => [g.kind, g.status, g.value])).toEqual([
      ["uf_cumulative", "computed", 2.96],
      ["upper_division", "unknown", null],
    ]);
    expect(a.gpa[1].reasons[0].code).toBe("gpa_rule_not_checked");
    expect(a.programs[0].gpa.map((g) => g.kind)).toEqual(["uf_cumulative", "upper_division", "major", "critical_tracking"]);
  });

  it("lists courses that count twice, each backed by the audits", () => {
    const psy2012 = a.sharedCourses.find((c) => c.courseId === "psy2012")!;
    // Major intro and Gen Ed S: different counting domains of one program.
    expect(psy2012.countedIn.map((x) => [x.requirementKey, x.section])).toEqual([
      ["introductory-level", "major"],
      ["gened-social", "geneed"],
    ]);
    for (const c of a.sharedCourses)
      for (const x of c.countedIn) {
        const r = a.programs.find((p) => p.programId === x.programId)!.requirements.find((q) => q.requirementKey === x.requirementKey)!;
        expect([...r.appliedCourses, ...r.pendingCourses].map((ac) => ac.courseId), `${c.courseId} in ${x.requirementKey}`).toContain(c.courseId);
      }
  });

  it("lists every unknown requirement with its reasons", () => {
    const unknown = a.programs.flatMap((p) => p.requirements.filter((r) => r.countsTowardDegree && r.status === "unknown").map((r) => r.requirementKey));
    expect(a.unknowns.map((u) => u.requirementKey)).toEqual(unknown);
    expect(a.unknowns.length).toBeGreaterThan(0);
  });

  it("reports a program under review as one unknown, and remaining credits", () => {
    const review = Object.values(catalog.programs).find((p) => p.status === "needs_review" && p.kind === "minor")!;
    const r = engine.audit(withRecord((x) => x.programs.push({ programId: review.id })));
    expect(r.unknowns.filter((u) => u.programId === review.id)).toEqual([
      expect.objectContaining({ requirementKey: null, reasons: [expect.objectContaining({ code: "program_needs_review" })] }),
    ]);
    // Geology minor: 17 credits; only the 6-credit GLY 3000/4000 elective is
    // still open, with GLY 4155C (3) in progress: 3 remain.
    expect(a.programs[1].totals.remaining.credits).toBe(3);
  });
});

describe("requirementFlags: what scoring needs", () => {
  const all = Object.keys(catalog.courses);
  const flags = engine.requirementFlags(json, all);
  const of = (code: string) => flags.courses.find((c) => c.courseId === toCourseId(code))!;

  it("a course for an open major requirement: both flags yes", () => {
    // Psychology BS01's Advanced BCN Laboratory is still open; PSB 4343C is one of its options.
    const f = of("PSB 4343C");
    expect([f.fillsRequirement, f.fillsMajorSlot]).toEqual(["yes", "yes"]);
    expect(f.requirements.map((r) => `${r.programId}/${r.requirementKey}`)).toContain(`${PSY}/advanced-bcn-laboratory`);
  });

  it("gen ed and minors fill a requirement but not a major slot", () => {
    expect([of("AEB 2014").fillsRequirement, of("AEB 2014").fillsMajorSlot]).toEqual(["yes", "no"]); // Gen Ed S
    const gly = of("GLY 3163"); // Geology minor elective, 3000 level
    expect(gly.fillsRequirement).toBe("yes");
    expect(gly.fillsMajorSlot).toBe("no");
    expect(gly.requirements.every((r) => r.programKind === "minor")).toBe(true);
  });

  it("a course the student holds helps nothing more", () => {
    for (const code of ["BSC 2010", "GLY 3202C", "MAC 2311"]) {
      const f = of(code);
      expect([f.fillsRequirement, f.fillsMajorSlot, f.reasons[0].code], code).toEqual(["no", "no", "already_held"]);
    }
  });

  it("an undecidable requirement gives unknown, which scoring reads as no", () => {
    // The record doesn't say whether the student has language proficiency,
    // which would waive the CLAS language requirement.
    const f = of("CHI 1130");
    expect(f.fillsRequirement).toBe("unknown");
    expect(toScoringFlags(f)).toEqual({ fillsRequirement: false, fillsMajorSlot: false });
    expect(toScoringFlags(of("PSB 4343C"))).toEqual({ fillsRequirement: true, fillsMajorSlot: true });
  });

  it("only flags courses the audit lists for an open requirement", () => {
    const audit = engine.audit(json);
    const open = new Set(
      audit.programs.flatMap((p) => p.requirements.filter((r) => r.countsTowardDegree && (r.status === "not_satisfied" || r.status === "unknown")).map((r) => `${p.programId}/${r.requirementKey}`)),
    );
    for (const c of flags.courses) for (const r of c.requirements) expect(open.has(`${r.programId}/${r.requirementKey}`)).toBe(true);
    expect(flags.courses.length).toBe(all.length);
  });

  it("rejects flags that contradict their requirements", () => {
    const f = of("PSB 4343C");
    expect(CourseFlags.safeParse({ ...f, fillsMajorSlot: "no" }).success).toBe(false);
    expect(CourseFlags.safeParse({ ...f, requirements: [] }).success).toBe(false);
  });
});

describe("filterCandidates: the hard filter before scoring", () => {
  const f = engine.filterCandidates(json, ["BSC 2010", "GLY 3202C", "GLY 3105C", "PSY 2012", "GLY 4043", "not a course", "ZZZ 9999", "ABE 3212C"], SPRING_2027);
  const byInput = (input: string) => f.courses.find((c) => c.input === input)!;

  it("keeps the input order and says why for each", () => {
    expect(f.courses.map((c) => c.input)).toEqual(["BSC 2010", "GLY 3202C", "GLY 3105C", "PSY 2012", "GLY 4043", "not a course", "ZZZ 9999", "ABE 3212C"]);
  });

  it("excludes held, ineligible, unscheduled and unknown courses", () => {
    expect([byInput("BSC 2010").decision, byInput("BSC 2010").reasons[0].code]).toEqual(["excluded", "already_held"]);
    expect([byInput("GLY 3202C").decision, byInput("GLY 3202C").reasons[0].code]).toEqual(["excluded", "already_held"]);
    // Eligible, but not in the published Spring 2027 schedule.
    expect([byInput("GLY 3105C").eligibility, byInput("GLY 3105C").decision, byInput("GLY 3105C").reasons[0].code]).toEqual(["eligible", "excluded", "not_offered"]);
    expect([byInput("ABE 3212C").eligibility, byInput("ABE 3212C").decision]).toEqual(["not_eligible", "excluded"]);
    expect([byInput("not a course").decision, byInput("not a course").courseId]).toEqual(["excluded", null]);
    expect(byInput("ZZZ 9999").reasons[0].code).toBe("unknown_course");
  });

  it("an eligible_pending course is a candidate that says what it rests on", () => {
    // GLY 4043 is eligible once GLY 3202C passes, but ran only in Fall 2025.
    const gly = byInput("GLY 4043");
    expect([gly.eligibility, gly.offering, gly.decision]).toEqual(["eligible_pending", "not_scheduled", "excluded"]);
    const all = engine.filterCandidates(json, Object.keys(catalog.courses), SPRING_2027);
    const pending = all.courses.filter((c) => c.eligibility === "eligible_pending" && c.decision === "candidate");
    expect(pending.length).toBeGreaterThan(0);
    for (const c of pending) expect(c.reasons.map((r) => r.code), c.input).toContain("in_progress_pending");
  });

  it("an unknown eligibility is never a candidate", () => {
    const all = engine.filterCandidates(json, Object.keys(catalog.courses), SPRING_2027);
    for (const c of all.courses) {
      if (c.eligibility === "unknown") expect(c.decision, c.input).not.toBe("candidate");
      if (c.decision === "candidate") expect(["eligible", "eligible_pending"]).toContain(c.eligibility);
    }
    // In a future term the offering is an assumption, stated on the candidate.
    const later = engine.filterCandidates(json, ["PSY 2012"], { season: "fall", year: 2027 }).courses[0];
    expect(later.decision).toBe("excluded"); // already passed
    const chm = engine.filterCandidates(json, ["CHM 2045"], { season: "fall", year: 2027 }).courses[0];
    expect(chm.offering).toBe("historical");
    if (chm.decision === "candidate") expect(chm.reasons.map((r) => r.code)).toContain("offering_unconfirmed");
  });
});

describe("tracking(student)", () => {
  const t = engine.tracking(json);

  it("tracks programs with milestones and says which have none", () => {
    expect(t.programs.map((p) => p.programId)).toEqual([PSY]);
    expect(t.untracked.map((u) => u.programId)).toEqual([GEOLOGY]);
  });

  it("names each milestone's deadline term and the next deadline", () => {
    const psy = t.programs[0];
    for (const m of psy.milestones) expect(m.dueTerm).toEqual(semesterTerm(record.firstTerm, m.semester));
    // Semester 3 (this term) has a count resting on current courses and an
    // unchecked GPA rule: that is the next deadline, Fall 2026.
    expect(psy.nextDeadline).toEqual({ semester: 3, term: { season: "fall", year: 2026 }, milestones: [5, 6] });
    expect(t.nextDeadline).toEqual({ programId: PSY, semester: 3, term: { season: "fall", year: 2026 } });
  });
});

describe("whatIf: on a copy, never the saved record", () => {
  const frozen = deepFreeze(structuredClone(json));
  const before = JSON.stringify(frozen);

  it("adds a program and reports the difference", () => {
    const w = engine.whatIf(frozen, { add: ["uglas-gpy_umn"], remove: [GEOLOGY] });
    expect(w.diff).toEqual({ added: ["uglas-gpy_umn"], removed: [GEOLOGY], changed: [] });
    expect(w.scenario.audit.programs.map((p) => p.programId)).toEqual([PSY, "uglas-gpy_umn"]);
    expect(w.baseline.programs.map((p) => p.programId)).toEqual([PSY, GEOLOGY]);
    // The copy is a different record version, so it can't be cached as the real one.
    expect(w.scenario.versions.recordVersion).toBe("1+what-if");
    expect(w.baseline.versions.recordVersion).toBe("1");
    // Unchanged programs give identical summaries.
    expect(w.scenario.programs[0]).toEqual(w.baseline.programs[0]);
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it("refuses what it can't evaluate", () => {
    expect(() => engine.whatIf(frozen, { catalogYear: "2025-2026" })).toThrow(/only the 2026-2027 catalog/);
    expect(() => engine.whatIf(frozen, { programs: [{ programId: PSY }], add: [GEOLOGY] })).toThrow();
    expect(() => engine.whatIf(frozen, { add: ["uglas-nope_umn"] })).toThrow(/unknown program/);
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

describe("determinism", () => {
  it("the same inputs give the same results", () => {
    const codes = ["PSB 4343C", "GLY 3163", "CHI 1130", "BSC 2010"];
    expect(engine.audit(json)).toEqual(engine.audit(json));
    expect(engine.requirementFlags(json, codes)).toEqual(engine.requirementFlags(json, codes));
    expect(engine.filterCandidates(json, codes)).toEqual(engine.filterCandidates(json, codes));
    expect(engine.tracking(json)).toEqual(engine.tracking(json));
  });
});
