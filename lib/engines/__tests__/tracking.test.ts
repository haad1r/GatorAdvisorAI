import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../catalog/load";
import { CourseHistory } from "../history";
import { AcademicRecord, type Catalog, type Milestone, TrackingResult } from "../schemas";
import { enrolledSemesters, evaluateTracking, planTrackingSlots } from "../tracking";

const catalog = loadCatalog(join(__dirname, "..", "..", "..", "data"));
const example = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "..", "examples", name), "utf8"));
const record = AcademicRecord.parse(example("record.json"));
const PSY = "uglas-psy_bs01";

const withRecord = (edit: (r: AcademicRecord) => void): AcademicRecord => {
  const r = structuredClone(record);
  edit(r);
  return AcademicRecord.parse(r);
};

/** The real Psychology program with its milestones replaced, so each test
 *  checks one rule. */
function withMilestones(milestones: Partial<Milestone>[]): Catalog {
  const p = catalog.programs[PSY];
  const full = milestones.map((m): Milestone => ({
    semester: 1, kind: "courses", slots: [], count: null, pool: [], rawText: "test",
    minGrade: null, gpaMin: null, gpaScope: null, ...m,
  }));
  return { ...catalog, programs: { ...catalog.programs, [PSY]: { ...p, milestones: full } } };
}
const uf = (min: number, semester: number): Partial<Milestone> => ({ kind: "gpa", gpaMin: min, gpaScope: "uf", semester });
const one = (m: Partial<Milestone>, r = record) => evaluateTracking(withMilestones([m]), r, PSY).milestones[0];

describe("tracking engine reproduces the example", () => {
  it("Psychology BS01, semester 3", () => {
    const expected = TrackingResult.parse(example("tracking.psychology-bs.json"));
    const got = evaluateTracking(catalog, record, PSY);
    expect(got).toEqual(expected);
    // The decisive facts, checked by hand against the page and the record:
    expect(got.status).toBe("unknown"); // the 2.6 critical-tracking GPA can't be checked
    const sem3 = got.milestones.find((m) => m.semester === 3 && m.kind === "count")!;
    expect(sem3).toMatchObject({ status: "pending", satisfiedBy: ["bsc2010"], pendingCourses: ["psb3340", "psy3213l"] });
    // UF GPA: (12 + 13.32 + 9 + 3 + 14.68 + 6 + 9 + 4) / 24 = 2.958; the W and
    // the dual-enrollment A are not in it, both BSC 2010 attempts are.
    expect(got.milestones.find((m) => m.semester === 3 && m.gpa?.scope === "uf")).toMatchObject({
      status: "met", gpa: { min: 2.7, value: 2.96 },
    });
  });
});

describe("semesters", () => {
  it("counts fall and spring terms, not summers", () => {
    expect(enrolledSemesters({ season: "fall", year: 2025 }, { season: "fall", year: 2026 })).toBe(3);
    expect(enrolledSemesters({ season: "fall", year: 2025 }, { season: "summer", year: 2026 })).toBe(2);
    expect(enrolledSemesters({ season: "spring", year: 2026 }, { season: "spring", year: 2026 })).toBe(1);
  });

  it("a summer start is heading into semester 1", () => {
    expect(enrolledSemesters({ season: "summer", year: 2026 }, { season: "summer", year: 2026 })).toBe(1);
  });
});

describe("course milestones", () => {
  it("applies the line's minimum grade (BSC 2010: D, then B)", () => {
    const slots = [[["bsc2010"]]];
    expect(one({ slots, minGrade: "B" }).status).toBe("met");
    expect(one({ slots, minGrade: "B+" }).status).toBe("not_met");
    // Without the repeat, the D passes an ungraded line but not a C line.
    const onlyD = withRecord((r) => (r.attempts = r.attempts.filter((a) => a.attemptId !== "a07")));
    expect(one({ slots }, onlyD).status).toBe("met");
    expect(one({ slots, minGrade: "C" }, onlyD)).toMatchObject({ status: "not_met", minGrade: "C" });
  });

  it('reads a minimum of "S" as S, or C or better', () => {
    const slots = [[["sta2023"]]]; // C
    expect(one({ slots, minGrade: "S" }).status).toBe("met");
    const withS = withRecord((r) => (r.attempts.find((a) => a.attemptId === "a06")!.grade = "S"));
    expect(one({ slots, minGrade: "S" }, withS).status).toBe("met");
    const withD = withRecord((r) => (r.attempts.find((a) => a.attemptId === "a06")!.grade = "D"));
    expect(one({ slots, minGrade: "S" }, withD).status).toBe("not_met");
  });

  it("a slot's alternative may be an AND-set (a lecture with its lab)", () => {
    const slots = [[["gly2010c", "psb3340"], ["mac2311"]]];
    expect(one({ slots }).status).toBe("met"); // MAC 2311 alone suffices
    const m = one({ slots: [[["gly2010c", "psb3340"]]], semester: 3 });
    expect(m).toMatchObject({ status: "pending", pendingCourses: ["psb3340"], missing: ["GLY 2010C + PSB 3340"] });
  });

  it("counts held slots against the count, completed before current", () => {
    const slots = [[["bsc2010"]], [["psb3340"]], [["psy3213l"]], [["sta3024"]]];
    expect(one({ kind: "count", count: 1, slots, semester: 3 }).status).toBe("met");
    expect(one({ kind: "count", count: 2, slots, semester: 3 }).status).toBe("pending");
    expect(one({ kind: "count", count: 4, slots, semester: 3 })).toMatchObject({
      status: "not_met", missing: ["PSB 3340", "PSY 3213L", "STA 3024"],
    });
    expect(one({ kind: "count", count: -1, slots, semester: 3 }).required).toBe(4);
  });

  it("an unmet milestone still ahead is upcoming; a missed one is not_met", () => {
    const slots = [[["sta3024"]]];
    expect(one({ slots, semester: 6 }).status).toBe("upcoming");
    expect(one({ slots, semester: 2 }).status).toBe("not_met");
  });

  it("a completed course with no grade makes the slot unknown", () => {
    const r = withRecord((x) => delete x.attempts.find((a) => a.attemptId === "a06")!.grade);
    expect(one({ slots: [[["sta2023"]]] }, r)).toMatchObject({ status: "unknown", reasons: [{ code: "missing_grade" }] });
  });

  it("doesn't trust a milestone weaker than an earlier one over the same courses", () => {
    const cat = withMilestones([
      { semester: 2, kind: "count", count: 2, slots: [[["bsc2010"]], [["sta2023"]]] },
      { semester: 3, kind: "count", count: 1, slots: [[["bsc2010"]], [["sta2023"]], [["psb3340"]]] },
    ]);
    const weak = evaluateTracking(cat, record, PSY).milestones[1];
    expect(weak.status).toBe("unknown");
    expect(weak.reasons[0]).toMatchObject({ code: "rule_not_modeled" });
    // Across the catalog it fires only on Psychology BS01's "1 tracking
    // course" and "the final tracking course".
    const history = new CourseHistory(record, catalog);
    const flagged = Object.values(catalog.programs)
      .filter((p) => p.milestones.length)
      .flatMap((p) => evaluateTracking(catalog, record, p.id, history).milestones
        .filter((m) => m.reasons.some((x) => x.message.includes("already asks for")))
        .map((m) => `${p.id}/${m.semester}`));
    expect(flagged).toEqual([`${PSY}/4`, `${PSY}/5`]);
  });
});

describe("a pool the page doesn't list", () => {
  it("is the model plan's tracking courses scheduled by that semester", () => {
    // Applied Biology: "Complete all critical-tracking courses, including labs".
    const slots = planTrackingSlots(catalog.programs["ugagl-bly_bs01"], 5);
    expect(slots).toEqual([
      [["chm2045", "chm2045l"]],
      [["chm2046", "chm2046l"]],
      [["mac2311"]],
      [["bsc2010", "bsc2010l"]],
      [["bsc2011", "bsc2011l"], ["bot2011c"]],
    ]);
    // The semester-8 capstone the plan also flags is not due by semester 5.
    expect(planTrackingSlots(catalog.programs["ugagl-bly_bs01"], 8).flat(2)).toContain("bsc4936");
  });
});

describe("GPA milestones", () => {
  it("checks the UF cumulative GPA (2.96 here)", () => {
    expect(one(uf(2.5, 2))).toMatchObject({ status: "met", gpa: { scope: "uf", min: 2.5, value: 2.96 } });
    expect(one(uf(3.0, 2))).toMatchObject({ status: "not_met", reasons: [{ code: "gpa_below_minimum" }] });
  });

  it("due this semester and below: rests on this term's grades", () => {
    const m = one(uf(3.0, 3));
    expect(m.status).toBe("pending");
    expect(m.pendingCourses).toEqual(["gly3202c", "gly4155c", "psb3340", "psy3213l"]);
  });

  it("a later semester's GPA is upcoming either way: it can still change", () => {
    expect(one(uf(2.5, 5)).status).toBe("upcoming");
    expect(one(uf(3.5, 5)).status).toBe("upcoming");
  });

  it("an ungraded UF course makes the GPA unknown", () => {
    const r = withRecord((x) => delete x.attempts.find((a) => a.attemptId === "a06")!.grade);
    expect(one(uf(2.0, 2), r)).toMatchObject({ status: "unknown", reasons: [{ code: "missing_grade" }] });
  });

  it("other GPAs are reported, not computed", () => {
    const m = one({ kind: "gpa", gpaMin: 2.5, gpaScope: "critical_tracking", semester: 2 });
    expect(m).toMatchObject({ status: "unknown", gpa: { value: null }, reasons: [{ code: "gpa_rule_not_checked" }] });
  });
});

describe("program status and inputs", () => {
  it("names every due milestone that isn't met", () => {
    const t = evaluateTracking(withMilestones([uf(3.0, 1), { slots: [[["sta3024"]]], semester: 2 }]), record, PSY);
    expect(t.status).toBe("not_met");
    expect(t.reasons.map((r) => r.message.slice(0, 11))).toEqual(["Semester 1:", "Semester 2:"]);
  });

  it("rejects a program with no milestones, and an unknown program", () => {
    expect(() => evaluateTracking(catalog, record, "uglas-gly_umn")).toThrow(/no Critical Tracking/);
    expect(() => evaluateTracking(catalog, record, "nope")).toThrow(RangeError);
  });

  it("every program with milestones gives a valid, deterministic result", () => {
    const history = new CourseHistory(record, catalog);
    for (const p of Object.values(catalog.programs)) {
      if (!p.milestones.length) continue;
      const t = evaluateTracking(catalog, record, p.id, history);
      expect(evaluateTracking(catalog, record, p.id, history)).toEqual(t);
    }
  });
});
