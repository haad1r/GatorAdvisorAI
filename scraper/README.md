# UF data scraper

Collects the UF data GatorAdvisor reasons over and writes it as CSV under
`data/`. The output is committed, so **you don't need to run the scraper to
use the data**. Run it only when UF publishes something new (a catalog year,
a semester's schedule) or when you change the parser.

| Source | Command | Output |
|---|---|---|
| Course catalog (catalog.ufl.edu, course pages) | `catalog` | `data/catalog/` |
| Schedule of Courses (one.uf.edu SOC API, every term since Fall 2021) | `soc` | `data/soc/` |
| Exam credit (AP, IB, AICE, CLEP, DSST, UEXCEL, CAPE, DLPT) | `examcredit` | `data/exam_credit/` |
| Majors, minors, certificates (catalog.ufl.edu program pages) | `programs` | `data/programs/` |

## Setup

Python 3.12+.

```bash
cd scraper
python -m venv .venv
.venv/Scripts/activate            # macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
```

## Running

Run every command from `scraper/`. Run them in this order, because later
steps read earlier output:

```bash
python -m scraper.run catalog      # 1. courses + requisites
python -m scraper.run soc          # 2. sections per term
python -m scraper.run examcredit   # 3. awards (uses catalog credits)
python -m scraper.run programs     # 4. requirements, plans, QA (needs catalog; uses soc)
python -m scraper.run report       # 5. data/programs/review_queue.md
```

`catalog` validation also reads `data/soc/courses.csv` (when it exists) to
resolve renumbered courses. On a scrape from scratch, run `catalog` once more
after `soc`. That second run is served from the cache, so it costs no requests.

Useful flags (`--help` on any command lists them all):

- `--dry-run`: fetch and parse, write nothing.
- `--dept <text>` (catalog), `--term 2271` (soc), `--program <text>` (programs):
  preview a subset, write nothing.
- `--force`: allow network requests during a cooldown (see below).
- `-v`: debug logging.

`python -m scraper.run review <program_id> [--stamp]` prints one program's
parse beside its override file. `--stamp` records the page's current
fingerprint in the override once you've checked the page by hand.

## Caching and politeness

Every request goes through `scraper/fetch.py`:

- One request at a time, 2-5 s apart, with retry and backoff; `robots.txt` is honoured.
- Responses are cached under `scraper/cache/<source>/` (gitignored). A cached
  page is reused until its TTL expires, then revalidated with ETag/Last-Modified.
- **Cooldown:** after a run that touched the network finishes, that source
  refuses uncached fetches for a while. Cache hits still work, and expired
  entries are served stale instead of being revalidated. An interrupted run
  writes no cooldown stamp, so rerunning it resumes from the cache.

| Source | Cache TTL | Cooldown |
|---|---|---|
| catalog | 7 days | 7 days |
| programs | 7 days | 30 days |
| soc | 1 day (ended terms never expire) | 1 day |
| examcredit | 30 days | 30 days |

All of these live in `scraper/scraper/config.py`, along with `CATALOG_YEAR`
(bump it when UF rolls the catalog over) and `SOC_FIRST_TERM`.

**A fresh clone has no cache and no cooldown stamps.** The first run of any
command scrapes for real: about 135 catalog pages, about 530 program pages, and
thousands of SOC pages. Each run's `manifest.json` records `network_requests`,
so you can see what a run cost.

## What's in `data/`

Every folder has a `manifest.json` with the source URL, fetch times, row counts
and the run's network request count. Course ids are lowercase with no space
(`mac2311`); `|` separates multi-valued cells.

- `data/catalog/`
  - `courses.csv`: one row per catalog course (credits, Gen Ed, Quest,
    writing words, department).
  - `requisites.csv`: prerequisite and corequisite text plus a parsed `tree`
    (JSON). `status` is complete, partial or unparsed; `raw_text` is always kept.
- `data/soc/`
  - `sections/<term>.csv`: every section offered that term (credits,
    instructors, delivery, Gen Ed).
  - `courses.csv`: one row per course ever scheduled, with the terms and
    seasons it ran. `uf_course_ids` links renumbered courses.
  - `requisites.csv`: SOC's own requisite text, parsed the same way as the catalog's.
  - `terms.csv`: per-term completeness. A term that could not be fully
    fetched says why in `problems`.
- `data/exam_credit/awards.csv`: one row per exam and score band, giving
  courses, credits, Gen Ed and writing words. `credits_source` says where the
  number came from:
  - `explicit`: UF printed it in the cell.
  - `table_note`: the table's "3 Credits/Exam unless noted" row.
  - `assumed_course`: UF stated no credits, so the named course's catalog credits are used.
  - `assumed`: elective credit with no number stated; a family default.

  Treat both `assumed*` values as unverified.
- `data/programs/`
  - `programs.csv`: one row per program, with `status` (`published` or
    `needs_review`), `confidence`, and the page `fingerprint`.
    `override_reason` is set when a hand override changed anything.
  - `requirements.csv`: requirement groups. `rtype` is the kind of
    requirement, `logic` is JSON, and `eligible_course_ids` lists the
    courses. `section="options"` marks reference pools and alternative
    routes that QA does not score.
  - `plans.csv`, `milestones.csv`: the model semester plan and its tracking milestones.
  - `qa.csv`: every QA finding (`ERROR`/`WARNING`; `advisory` rows are informational).
  - `review_queue.md`: generated by `report`. Don't edit it by hand.

Only `published` programs should be shown to students as an audit-ready
curriculum.

## Program overrides

The program parser gets most pages right, but not all. A page it can't read
correctly gets a hand correction in `scraper/program_overrides/<program_id>.json`.
(`scraper/overrides.json` does the same for individual courses.)

```json
{
  "reason": "URL + what was checked on the page, quoting it",
  "reviewed": {"date": "2026-10-12", "catalog_year": "2026-2027", "fingerprint": "5dd7a794fa416ef2"},
  "status": "published",
  "patch_groups":   {"<group_key>": {"name": "...", "section": "options"}},
  "add_groups":     [{"group_key": "...", "name": "...", "rtype": "...", "...": "..."}],
  "exclude_groups": ["<group_key>"],
  "count_rules":    {"<group_key>": [{"at_most": 1, "unit": "courses", "prefixes": ["for", "plp"], "text": "the page's sentence"}]},
  "exclusive_sets": {"<set_name>": ["<group_key>", "<group_key>"]}
}
```

Rules:

- `reason` and `reviewed` are required. `reason` cites the page and quotes
  what was checked. Take the fingerprint from `programs.csv`, or run
  `review <id> --stamp`.
- **Stale overrides.** If the page changes (different fingerprint or catalog
  year), the override is stale. Its corrections still apply, but a forced
  `status` is withdrawn until someone re-checks the page and re-stamps it.
- **QA still applies.** A forced `published` is refused while QA errors
  remain. Fix the data in the override, not just the status.
- **Course ids and group keys must exist.** Course ids must be in the
  catalog, the SOC, or be graduate-level (5000-7999). Every group key an
  override references must exist on the parsed page. If a parser change
  renames a group, the run aborts so the override gets rewritten, rather than
  silently doing nothing.
- **`patch_groups` replaces fields wholesale.** To change one value inside
  `logic`, copy the whole current `logic` and edit it.
- **Keep alternatives visible.** Use `"section": "options"` to show an
  alternative route without requiring it.
- **`count_rules`** filter by prefix and/or level (`at_least`/`at_most`,
  `unit` courses or credits, `text` = the page's own sentence). The full
  field reference is in the `scraper/scraper/qa.py` module docstring.
- **`exclusive_sets`** means one course can fill only one of the listed groups.
- **Parser rule or override?** Prefer a parser rule when three or more
  programs share a page shape. Use an override for one-offs.

## Tests

```bash
cd scraper
python -m pytest -q
```

Parser tests run offline against real program pages saved in
`tests/fixtures/programs/`. When you fix a page shape, save that page as a
fixture and add a test.

## Checking a parser change

1. Copy `data/programs` somewhere.
2. Run `programs` and diff the output. Every status change and every changed
   requirement group should be explained by the change you made.
3. Run the tests, then `report`.
4. Run `programs` again and confirm the output is byte-identical to the first run.
