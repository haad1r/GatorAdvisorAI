"""Load the CSVs in data/ into the Supabase `catalog` schema.

    python3 tools/db/load_catalog.py                 # every table
    python3 tools/db/load_catalog.py terms courses   # only these
    python3 tools/db/load_catalog.py --dry-run       # write the SQL to tools/db/out/, run nothing

Rows are upserted, then rows that are no longer in the CSV are deleted, so a
re-run changes nothing and ids stay stable. SQL goes through
`supabase db query --remote` (the linked project, using your CLI login), or
through psql when SUPABASE_DB_URL is set.
"""

import argparse
import csv
import glob
import json
import os
import secrets
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = Path(__file__).resolve().parent / "out"
# The CLI rejects requests somewhere between 1 and 4 MB.
BATCH_BYTES = 800_000
# The CLI changes its output when it thinks an AI agent is running it; pin one shape.
CLI_FORMAT = ["--agent", "no", "--output-format", "json"]

# Long fields (course descriptions, requirement JSON). sys.maxsize overflows a C long on Windows.
csv.field_size_limit(2**31 - 1)


def text(v):
    return v if v != "" else None


def required(v):
    return v


def number(v):
    return v if v != "" else None


def boolean(v):
    if v not in ("True", "False"):
        raise ValueError(f"expected True/False, got {v!r}")
    return v == "True"


def pipe_list(v):
    return v.split("|") if v else []


def json_value(v):
    return json.loads(v) if v else None


def json_list(v):
    return json.loads(v) if v else []


@dataclass
class Table:
    name: str
    key: list[str]
    columns: dict[str, tuple[str, Callable]]  # db column -> (csv column, converter)
    files: Callable[[], list[Path]]
    scope: str | None = None  # prune per value of this column instead of the whole table
    extra: Callable[[list[dict]], None] = field(default=lambda rows: None)


def one(path):
    return lambda: [DATA / path]


def number_milestones(rows):
    seen = {}
    for r in rows:
        k = (r["program_id"], r["semester"])
        seen[k] = seen.get(k, 0) + 1
        r["position"] = seen[k]


def rmp_fetched_at(rows):
    stamp = json.loads((DATA / "rmp/manifest.json").read_text(encoding="utf-8"))["fetched_at"]
    for r in rows:
        r["fetched_at"] = stamp


SOURCE = {"catalog_year": ("catalog_year", required), "source_url": ("source_url", required), "fetched_at": ("fetched_at", required)}

TABLES = [
    Table("terms", ["term"], {
        "term": ("term", required), "name": ("name", required),
        "closed": ("closed", boolean), "complete": ("complete", boolean),
        "fetched_at": ("fetched_to", text),
    }, one("soc/terms.csv")),
    Table("courses", ["id"], {
        "id": ("id", required), "code": ("code", required), "name": ("name", required),
        "credits_min": ("credits_min", number), "credits_max": ("credits_max", number),
        "description": ("description", text), "grading": ("grading", text),
        "gen_ed": ("gen_ed", pipe_list), "quest": ("quest", text),
        "writing_words": ("writing_words", number), "other_attributes": ("other_attributes", pipe_list),
        "dept_slug": ("dept_slug", text), **SOURCE,
    }, one("catalog/courses.csv")),
    Table("requisites", ["course_id", "kind"], {
        "course_id": ("course_id", required), "kind": ("kind", required), "status": ("status", required),
        "tree": ("tree", json_value), "mentions": ("mentions", json_list), "raw_text": ("raw_text", required),
        **SOURCE,
    }, one("catalog/requisites.csv")),
    Table("programs", ["id"], {
        "id": ("id", required), "name": ("name", required), "kind": ("kind", required),
        "degree": ("degree", text), "college_slug": ("college_slug", text), "status": ("status", required),
        "confidence": ("confidence", number), **SOURCE,
    }, one("programs/programs.csv")),
    Table("requirement_groups", ["program_id", "group_key"], {
        "program_id": ("program_id", required), "group_key": ("group_key", required), "name": ("name", required),
        "rtype": ("rtype", required), "logic": ("logic", json_value),
        "eligible_course_ids": ("eligible_course_ids", json_list),
        "required_credits": ("required_credits", number), "required_course_count": ("required_course_count", number),
        "sort_order": ("sort_order", required), "section": ("section", required),
    }, one("programs/requirements.csv")),
    Table("tracking_milestones", ["program_id", "semester", "position"], {
        "program_id": ("program_id", required), "semester": ("semester", required), "position": ("position", required),
        "kind": ("kind", required), "slots": ("slots", json_value), "count": ("count", number),
        "pool": ("pool", json_value), "raw_text": ("raw_text", required),
        "min_grade": ("min_grade", text), "gpa_min": ("gpa_min", number), "gpa_scope": ("gpa_scope", text),
    }, one("programs/milestones.csv"), extra=number_milestones),
    Table("model_plan_courses", ["program_id", "semester_index", "position"], {
        "program_id": ("program_id", required), "semester_index": ("semester_index", required),
        "position": ("position", required), "course_id": ("course_id", text), "placeholder": ("placeholder", text),
        "credits": ("credits", number), "is_critical_tracking": ("is_critical_tracking", boolean),
        "is_summer": ("is_summer", boolean), "alt_group": ("alt_group", text), "alt_option": ("alt_option", text),
    }, one("programs/plans.csv")),
    Table("sections", ["term", "class_number"], {
        "term": ("term", required), "class_number": ("class_number", required), "course_id": ("course_id", required),
        "section": ("section", required), "credits_min": ("credits_min", number), "credits_max": ("credits_max", number),
        "career": ("career", text), "delivery": ("delivery", text), "instructors": ("instructors", pipe_list),
        "gen_ed": ("gen_ed", pipe_list), "quest": ("quest", text), "topic": ("topic", text),
        "dept_name": ("dept_name", text),
    }, lambda: sorted(Path(p) for p in glob.glob(str(DATA / "soc/sections/*.csv"))), scope="term"),
    Table("exam_awards", ["id"], {
        "id": ("id", required), "family": ("family", required), "exam": ("exam", required),
        "min_score": ("min_score", number), "max_score": ("max_score", number),
        "course_ids": ("course_ids", pipe_list), "credits": ("credits", number), "gen_ed": ("gen_ed", pipe_list),
        "award_text": ("award_text", required), **SOURCE,
    }, one("exam_credit/awards.csv")),
    Table("professor_ratings", ["rmp_id"], {
        "rmp_id": ("legacy_id", required), "first_name": ("first_name", required), "last_name": ("last_name", required),
        "department": ("department", text), "quality": ("quality", number), "difficulty": ("difficulty", number),
        "would_take_again": ("would_take_again", number), "num_ratings": ("num_ratings", required),
        "fetched_at": ("fetched_at", required),
    }, one("rmp/professors.csv"), extra=rmp_fetched_at),
    Table("instructor_matches", ["instructor_name"], {
        "instructor_name": ("instructor", required), "rmp_id": ("legacy_id", text), "match": ("match", required),
    }, one("rmp/instructor_ratings.csv")),
]


def read_rows(table: Table) -> list[dict]:
    raw = []
    for path in table.files():
        with open(path, newline="", encoding="utf-8") as f:
            raw.extend(csv.DictReader(f))
    table.extra(raw)
    rows = []
    for i, r in enumerate(raw):
        try:
            rows.append({col: conv(r[src]) for col, (src, conv) in table.columns.items()})
        except (KeyError, ValueError) as e:
            raise SystemExit(f"{table.name}: row {i + 1}: {e}")
    unique: dict[tuple, dict] = {}
    for r in rows:
        k = tuple(r[c] for c in table.key)
        if k in unique and unique[k] != r:
            raise SystemExit(f"{table.name}: two different rows share the key {dict(zip(table.key, k))}")
        unique[k] = r
    if len(unique) < len(rows):
        print(f"{table.name}: dropped {len(rows) - len(unique)} exact repeated rows")
    return list(unique.values())


def literal(payload: str) -> str:
    """Dollar-quote JSON so no escaping is needed."""
    while True:
        tag = f"$j{secrets.token_hex(4)}$"
        if tag not in payload:
            return f"{tag}{payload}{tag}::jsonb"


def batches(rows: list[dict]):
    batch, size = [], 2
    for r in rows:
        n = len(json.dumps(r, ensure_ascii=False)) + 1
        if batch and size + n > BATCH_BYTES:
            yield batch
            batch, size = [], 2
        batch.append(r)
        size += n
    if batch:
        yield batch


def upsert_sql(table: Table, rows: list[dict]) -> str:
    cols = list(table.columns)
    rest = [c for c in cols if c not in table.key]
    t = f"catalog.{table.name}"
    payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    return (
        f"insert into {t} ({', '.join(cols)})\n"
        f"select {', '.join(cols)} from jsonb_populate_recordset(null::{t}, {literal(payload)})\n"
        f"on conflict ({', '.join(table.key)}) do update set {', '.join(f'{c} = excluded.{c}' for c in rest)}\n"
        f"where ({', '.join(f'{t}.{c}' for c in rest)}) is distinct from ({', '.join(f'excluded.{c}' for c in rest)});"
    )


def prune_sql(table: Table, rows: list[dict], scope_value=None) -> str:
    t = f"catalog.{table.name}"
    keys = [{k: r[k] for k in table.key} for r in rows]
    payload = json.dumps(keys, ensure_ascii=False, separators=(",", ":"))
    match = " and ".join(f"k.{c} = {t}.{c}" for c in table.key)
    where = f"{table.scope} = {literal(json.dumps(scope_value))} #>> '{{}}' and " if table.scope else ""
    return (
        f"delete from {t} where {where}not exists (\n"
        f"  select 1 from jsonb_populate_recordset(null::{t}, {literal(payload)}) k where {match});"
    )


def prune_scopes_sql(table: Table, values: list[str]) -> str:
    t = f"catalog.{table.name}"
    return f"delete from {t} where {table.scope} not in (select jsonb_array_elements_text({literal(json.dumps(values))}));"


def statements(table: Table, rows: list[dict]):
    """(label, sql) pairs, in the order they must run."""
    for i, b in enumerate(batches(rows), 1):
        yield f"upsert batch {i} ({len(b)} rows)", upsert_sql(table, b)
    if not table.scope:
        yield "remove rows no longer in the CSV", prune_sql(table, rows)
        return
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(r[table.scope], []).append(r)
    for value, group in groups.items():
        yield f"remove {table.scope} {value} rows no longer in the CSV", prune_sql(table, group, value)
    yield f"remove {table.scope}s no longer in the CSV", prune_scopes_sql(table, list(groups))


def run(sql: str) -> None:
    OUT.mkdir(exist_ok=True)
    path = OUT / "current.sql"
    path.write_text(sql, encoding="utf-8")
    if os.environ.get("SUPABASE_DB_URL"):
        cmd = ["psql", os.environ["SUPABASE_DB_URL"], "-v", "ON_ERROR_STOP=1", "-q", "-1", "-f", str(path)]
    else:
        cmd = ["supabase", "db", "query", "--remote", "--yes", *CLI_FORMAT, "-f", str(path)]
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0 or '"_tag":"Error"' in result.stdout.replace(" ", ""):
        sys.stdout.write(result.stdout[-2000:])
        sys.stderr.write(result.stderr[-2000:])
        raise SystemExit("The database rejected that statement. Nothing after it ran.")


def count(table: Table) -> int:
    t = f"catalog.{table.name}"
    if os.environ.get("SUPABASE_DB_URL"):
        out = subprocess.run(["psql", os.environ["SUPABASE_DB_URL"], "-tAc", f"select count(*) from {t}"],
                             capture_output=True, text=True, encoding="utf-8", check=True).stdout
        return int(out.strip())
    out = subprocess.run(["supabase", "db", "query", "--remote", "--read-only", *CLI_FORMAT,
                          f"select count(*) as n from {t}"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True).stdout
    return int(json.loads(out)[0]["n"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("tables", nargs="*", help="table names (default: all)")
    parser.add_argument("--dry-run", action="store_true", help="write SQL files to tools/db/out/ and run nothing")
    args = parser.parse_args()

    names = [t.name for t in TABLES]
    unknown = set(args.tables) - set(names)
    if unknown:
        raise SystemExit(f"Unknown table(s): {', '.join(sorted(unknown))}. Choose from: {', '.join(names)}")
    chosen = [t for t in TABLES if not args.tables or t.name in args.tables]

    if not args.dry_run and not os.environ.get("SUPABASE_DB_URL") and not shutil.which("supabase"):
        raise SystemExit("Install the Supabase CLI and run `supabase link`, or set SUPABASE_DB_URL.")

    for table in chosen:
        files = table.files()
        if not files or not all(p.exists() for p in files):
            print(f"{table.name}: skipped, {', '.join(str(p.relative_to(ROOT)) for p in files) or 'no files'} not found")
            continue
        rows = read_rows(table)
        if not rows:
            raise SystemExit(f"{table.name}: the CSV is empty; refusing to load (it would delete every row)")
        print(f"{table.name}: {len(rows)} rows")
        for n, (label, sql) in enumerate(statements(table, rows), 1):
            if args.dry_run:
                OUT.mkdir(exist_ok=True)
                (OUT / f"{table.name}-{n:03}.sql").write_text(sql, encoding="utf-8")
            else:
                run(sql)
            print(f"  {label}")
        if not args.dry_run:
            in_db = count(table)
            print(f"  database now has {in_db} rows" + ("" if in_db == len(rows) else f" (expected {len(rows)})"))
            if in_db != len(rows):
                raise SystemExit(f"{table.name}: row count doesn't match the CSV")


if __name__ == "__main__":
    main()
