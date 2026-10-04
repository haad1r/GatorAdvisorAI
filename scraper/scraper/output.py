"""Write scraper results into data/ as CSV and JSON.

Every file is written to a temp file in the same folder and renamed into place,
so a crash never leaves half a CSV behind. Cell conventions:
- lists of plain codes use "|"   (gen_ed: "humanities|international")
- trees and id lists use JSON    (tree: {"type":"or","items":[...]})
- missing values are empty cells, never a made-up default
- every row carries catalog_year, source_url and fetched_at
"""

from __future__ import annotations

import csv
import io
import json
import os
import tempfile
from pathlib import Path
from typing import Iterable

from . import catalog
from .fetch import Page

COURSE_HEADER = [
    "id", "code", "name", "credits_min", "credits_max", "description", "grading",
    "gen_ed", "quest", "writing_words", "other_attributes", "dept_slug",
    "override_reason", "catalog_year", "source_url", "fetched_at",
]
REQUISITE_HEADER = [
    "course_id", "kind", "status", "tree", "mentions", "raw_text",
    "override_reason", "catalog_year", "source_url", "fetched_at",
]


# ============================================================================
# Atomic writes
# ============================================================================

def atomic_write_text(path: Path, text: str) -> None:
    """Write to a temp file beside `path`, then rename it over `path`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def write_csv(path: Path, header: list[str], rows: Iterable[list]) -> int:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    count = 0
    for row in rows:
        writer.writerow(row)
        count += 1
    atomic_write_text(path, buffer.getvalue())
    return count


def write_json(path: Path, data: object) -> None:
    atomic_write_text(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")


# ============================================================================
# Cell formatting
# ============================================================================

def _num(value: float | None) -> str:
    """3.0 -> "3", 1.5 -> "1.5", None -> ""."""
    if value is None:
        return ""
    return str(int(value)) if value == int(value) else str(value)


def _json(value: object) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


# ============================================================================
# Catalog
# ============================================================================

def write_catalog(out_dir: Path, courses: Iterable[catalog.Course], pages: dict[str, Page],
                  reasons: dict[str, str], catalog_year: str, manifest: dict) -> None:
    """data/catalog/courses.csv, requisites.csv and manifest.json.
    `pages` maps dept_slug -> the Page each course was parsed from."""
    courses = sorted(courses, key=lambda c: c.id)

    def provenance(course: catalog.Course) -> list[str]:
        page = pages[course.dept_slug]
        return [reasons.get(course.id, ""), catalog_year, page.url, page.fetched_at.isoformat()]

    course_count = write_csv(out_dir / "courses.csv", COURSE_HEADER, (
        [c.id, c.code, c.name, _num(c.credits_min), _num(c.credits_max), c.description,
         c.grading or "", "|".join(c.gen_ed), "|".join(c.quest), c.writing_words or "",
         "|".join(c.other_attributes), c.dept_slug, *provenance(c)]
        for c in courses
    ))

    requisite_count = write_csv(out_dir / "requisites.csv", REQUISITE_HEADER, (
        [c.id, kind, req.status, _json(req.tree), _json(req.mentions), req.raw_text, *provenance(c)]
        for c in courses
        for kind, req in (("prereq", c.prereq), ("coreq", c.coreq))
        if req is not None
    ))

    fetched = sorted(page.fetched_at for page in pages.values())
    write_json(out_dir / "manifest.json", {
        "source": "catalog.ufl.edu",
        "catalog_year": catalog_year,
        "department_pages": len(pages),
        "fetched_from": fetched[0].isoformat() if fetched else None,
        "fetched_to": fetched[-1].isoformat() if fetched else None,
        "files": {"courses.csv": course_count, "requisites.csv": requisite_count},
        **manifest,
    })
