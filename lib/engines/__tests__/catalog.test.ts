import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG_FILES, type CatalogFile, buildCatalog, loadCatalog } from "../catalog/load";
import { parseCsv } from "../catalog/csv";

const DATA_DIR = join(__dirname, "..", "..", "..", "data");
const catalog = loadCatalog(DATA_DIR);

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded newlines and CRLF", () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\r\n');
    expect(rows).toEqual([{ a: "x, y", b: 'say "hi"\nthere' }]);
  });

  it("refuses a ragged row instead of guessing", () => {
    expect(() => parseCsv("a,b\n1,2,3\n")).toThrow(/3 fields, header has 2/);
  });
});

describe("loadCatalog", () => {
  it("loads every program, course and award the manifests count", () => {
    const manifest = (f: string) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8"));
    const programs = manifest("programs/manifest.json");
    expect(Object.keys(catalog.programs)).toHaveLength(programs.files["programs.csv"]);
    const groups = Object.values(catalog.programs).reduce((n, p) => n + p.requirements.length, 0);
    expect(groups).toBe(programs.files["requirements.csv"]);
    const catalogCourses = Object.values(catalog.courses).filter((c) => c.origin === "catalog");
    expect(catalogCourses).toHaveLength(manifest("catalog/manifest.json").files["courses.csv"]);
    expect(Object.keys(catalog.examAwards)).toHaveLength(manifest("exam_credit/manifest.json").files["awards.csv"]);
    expect(catalog.catalogYear).toBe("2026-2027");
  });

  it("is deterministic: a second import gives identical ids, data and version", () => {
    const again = loadCatalog(DATA_DIR);
    expect(again.dataVersion).toBe(catalog.dataVersion);
    expect(JSON.stringify(again)).toBe(JSON.stringify(catalog));
  });

  it("refuses a duplicate row instead of overwriting the first", () => {
    const files = Object.fromEntries(
      CATALOG_FILES.map((f) => [f, readFileSync(join(DATA_DIR, f), "utf8")]),
    ) as Record<CatalogFile, string>;
    const lines = files["programs/programs.csv"].split("\n");
    files["programs/programs.csv"] = [...lines.slice(0, 2), lines[1], ...lines.slice(2)].join("\n");
    expect(() => buildCatalog(files)).toThrow(/duplicate program/);
  });

  it("changes dataVersion when any input changes", () => {
    const files = Object.fromEntries(
      CATALOG_FILES.map((f) => [f, readFileSync(join(DATA_DIR, f), "utf8")]),
    ) as Record<CatalogFile, string>;
    files["exam_credit/awards.csv"] = files["exam_credit/awards.csv"].replace("Calculus AB", "Calculus  AB");
    expect(buildCatalog(files).dataVersion).not.toBe(catalog.dataVersion);
  });

  it("keeps a program's groups, milestones and source together", () => {
    const gly = catalog.programs["uglas-gly_umn"];
    expect(gly.requirements.map((g) => g.key)).toEqual([
      "requirements",
      "approved-electives",
      "elective-gly-courses-3000-4000-level-6",
    ]);
    expect(gly.source.fingerprint).toBe("8745e5cbe5d1cfdf");
    expect(catalog.programs["uglas-psy_bs01"].milestones.length).toBeGreaterThan(0);
  });

  it("attaches parsed requisites to courses", () => {
    expect(catalog.courses.gly3105c.prerequisite?.tree).toEqual({
      type: "or",
      items: [
        { type: "course", course_id: "gly2010c" },
        { type: "course", course_id: "gly2030c" },
      ],
    });
  });
});
