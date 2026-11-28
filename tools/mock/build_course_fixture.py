"""Build lib/mocks/course-fixture.json: a ~300-course slice of the real data
for the mocked /courses pages.

Picks, in order until it has 300: the mock student's courses, every course
the CS (B.S.) major lists, undergrad CISE courses, undergrad math/stats/
physics, then a spread of Gen Ed and Quest courses. For each course it keeps
the catalog entry, prerequisites, and the Fall 2026 / Spring 2027 sections
with each instructor's RateMyProfessors match. All of it is real public data;
nothing about a student.

Run from the repo root after the catalog, SOC or RMP data changes:

    python3 tools/mock/build_course_fixture.py
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = ROOT / "lib" / "mocks" / "course-fixture.json"
LIMIT = 300
TERMS = {"2268": "Fall 2026", "2271": "Spring 2027"}
STUDENT = ["cop3502c", "cop3503c", "mac2311", "mac2312", "enc1101", "chm2045", "psy2012", "amh2010", "amh2020",
           "phy2048", "phy2048l", "cot3100", "enc2210", "phi1680", "mac2313", "cop3530", "sta3032"]
CISE = ("cop", "cot", "cda", "cen", "cis", "cap", "cnt", "cgs")
MATH_SCI = ("mac", "mas", "map", "sta", "phy")


def rows(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def split(value: str) -> list[str]:
    return [v for v in value.split("|") if v]


def level(course_id: str) -> int:
    m = re.match(r"^[a-z]{3}(\d)", course_id)
    return int(m.group(1)) * 1000 if m else 0


def pretty_dept(slug: str) -> str:
    small = {"and", "of", "the", "for", "in"}
    return " ".join(w if w in small else w.capitalize() for w in slug.split("_"))


def main() -> None:
    courses = {r["id"]: r for r in rows(DATA / "catalog" / "courses.csv")}
    requisites: dict[str, list[dict]] = {}
    for r in rows(DATA / "catalog" / "requisites.csv"):
        requisites.setdefault(r["course_id"], []).append({"kind": r["kind"], "status": r["status"], "text": r["raw_text"]})
    soc = {r["course_id"]: r for r in rows(DATA / "soc" / "courses.csv")}

    major = []
    for r in rows(DATA / "programs" / "requirements.csv"):
        if r["program_id"] == "uglas-csc_bs" and r["section"] == "major":
            major += json.loads(r["eligible_course_ids"] or "[]")

    undergrad = [c for c in courses if 1000 <= level(c) < 5000]
    picked: list[str] = []

    def take(ids, cap=None):
        n = 0
        for c in ids:
            if len(picked) >= LIMIT or (cap is not None and n >= cap):
                return
            if c in courses and c not in picked:
                picked.append(c)
                n += 1

    take(STUDENT)
    take(major)
    take(sorted(c for c in undergrad if c.startswith(CISE)))
    take(sorted(c for c in undergrad if c.startswith(MATH_SCI)), cap=60)
    for area in ("composition", "humanities", "social", "biological", "physical", "mathematics", "international"):
        take(sorted(c for c in undergrad if area in split(courses[c]["gen_ed"])), cap=18)
    for quest in ("quest1", "quest2"):
        take(sorted(c for c in undergrad if courses[c]["quest"] == quest), cap=18)

    # Sections for the two open terms, and RMP matches for their instructors.
    sections: dict[str, dict[str, list[dict]]] = {}
    for term in TERMS:
        for s in rows(DATA / "soc" / "sections" / f"{term}.csv"):
            if s["course_id"] in picked and s["career"] == "UGRD":
                groups = sections.setdefault(s["course_id"], {}).setdefault(term, {})
                names = tuple(sorted(split(s["instructors"])))  # same people, any order = one group
                groups.setdefault(names, []).append([s["section"], s["class_number"], s["delivery"]])
    profs = {r["legacy_id"]: r for r in rows(DATA / "rmp" / "professors.csv")}
    matches = {r["instructor"]: r for r in rows(DATA / "rmp" / "instructor_ratings.csv")}
    # {course: {term: [{"instructors": [...], "sections": [[section, classNumber, delivery], ...]}]}}
    sections = {
        cid: {term: [{"instructors": list(names), "sections": secs} for names, secs in groups.items()] for term, groups in by_term.items()}
        for cid, by_term in sections.items()
    }
    used = {n for by_term in sections.values() for groups in by_term.values() for g in groups for n in g["instructors"]}

    def number(v: str):
        return float(v) if v else None

    ratings = {}
    for name in sorted(used):
        m = matches.get(name)
        if not m or not m["legacy_id"]:
            ratings[name] = None
            continue
        ratings[name] = {
            "rmpId": int(m["legacy_id"]),
            "quality": number(m["quality"]),
            "difficulty": number(m["difficulty"]),
            "wouldTakeAgainPercent": round(float(m["would_take_again"])) if m["would_take_again"] else None,
            "numRatings": int(m["num_ratings"] or 0),
        }
    assert all(r is None or str(r["rmpId"]) in profs for r in ratings.values())

    out = []
    for cid in picked:
        c = courses[cid]
        s = soc.get(cid, {})
        out.append({
            "id": cid,
            "code": c["code"],
            "name": c["name"],
            "credits": {"min": float(c["credits_min"] or 0), "max": float(c["credits_max"] or 0)},
            "description": c["description"],
            "genEd": split(c["gen_ed"]),
            "quest": c["quest"] or None,
            "department": c["dept_slug"],
            "departmentName": pretty_dept(c["dept_slug"]),
            "level": level(cid),
            "requisites": requisites.get(cid, []),
            "seasons": split(s.get("seasons", "")),
            "sections": sections.get(cid, {}),
            "sourceUrl": c["source_url"],
            "fetchedAt": c["fetched_at"],
        })

    OUT.write_text(json.dumps({"terms": TERMS, "courses": out, "ratings": ratings}, separators=(",", ":")) + "\n")
    n_sections = sum(len(g["sections"]) for by_term in sections.values() for groups in by_term.values() for g in groups)
    print(f"Wrote {len(out)} courses, {n_sections} sections, {len(ratings)} instructors "
          f"({sum(1 for r in ratings.values() if r)} rated) -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
