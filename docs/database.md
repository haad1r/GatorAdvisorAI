# Database

The schema for #6 (private student data) and #8 (catalog persistence). One migration creates everything: `supabase/migrations/20261118120000_initial_schema.sql`. This page explains why each piece is there.

## The big decisions

**Two schemas.** `catalog` holds public UF data loaded from `data/` (courses, programs, sections, RMP ratings). `public` holds private student data. They never mix: nothing in `catalog` is about a student, and catalog reloads can't touch student rows.

**The browser never talks to the database.** A request goes: screen → `useApi()` → Next.js route handler (`/api/...`) → database. The route handler checks the Clerk session, takes the user id from that session (never from the request body), and queries with Supabase's service role, filtering every query by that user id. This is #6 step 3's default, "authenticated backend endpoints". It also means there is one auth system (Clerk); we never use Supabase Auth or `auth.uid()`.

**Row Level Security (RLS) as a backstop.** RLS is on for all 24 tables with no policies. The service role bypasses RLS, so the server works normally. The `anon` and `authenticated` roles (what a browser would use) can't read or write a single row, even if a key leaks. If we ever need browser access, we add policies that map the Clerk id explicitly.

**Students are keyed by their Clerk user id** (`user_...`, a text column). `profiles` is the root: every private table references it with `ON DELETE CASCADE`, so deleting a profile deletes everything about that student.

## Private tables (`public`)

| Table | What it stores | Notes |
|---|---|---|
| `profiles` | One row per student: name, standing, program, catalog year, entry term, expected graduation | `program_id` has no foreign key to `catalog.programs` on purpose, so a catalog reload can never block or cascade into student data. `entry_term` is required: it anchors Critical Tracking semesters, and onboarding asks for it ("First term at UF"). |
| `coursework_records` | One row per student with a `version` | The version for the whole course list (see "stale writes" below). |
| `coursework` | One row per course attempt | A retake is two rows with different terms. `source` is transcript / manual / exam / transfer. `original_label` keeps the transcript's wording for review. Course codes are checked by the database (`COP3502C`, no space). |
| `survey_submissions` | Interest survey answers as JSON | Kept as history; the newest is current. `answers` matches `SurveyAnswer[]` in `lib/api/types.ts`. |
| `schedules` → `schedule_sections` → `schedule_meetings` | Saved weekly schedules, their sections, and meeting times | Several schedules per term for comparing; at most one `is_primary` per term (enforced by a unique index). Meetings live here because UF's public data has no times, so students enter them. |
| `plans` → `plan_courses` | Saved semester plans | `locked` survives regeneration. What-if results are never saved here (#8). `record_version` says which course list the plan was built from. |
| `chat_conversations` → `chat_messages` | AI advisor history (#10) | Only the tables are ours; the AI team owns what goes in them. Indexed so "latest 50 messages" stays fast. |
| `recommendation_events` | shown / liked / disliked / not interested / added to plan | Feedback for #11, tagged with `scoring_version`. |
| `account_deletions` | Progress of each account deletion | Deliberately **not** linked to `profiles`, so it survives the deletion it's tracking. See below. |

## Ideas worth understanding

**Foreign keys with `ON DELETE CASCADE`.** A foreign key says "this row must point at a real row over there". Cascade adds "and if that row is deleted, delete me too". That's how deleting one `profiles` row cleans up the other 11 student tables (all but `account_deletions`). It also blocks a late background job from writing data for a student who no longer exists: the insert fails because there's no profile to point at.

**Ownership enforced by the database.** Child tables (`schedule_sections`, `schedule_meetings`, `plan_courses`, `chat_messages`) repeat the owner's `user_id` and reference their parent by **both** id and user id, e.g. `foreign key (schedule_id, user_id) references schedules (id, user_id)`. So even a buggy endpoint can't attach student B's section to student A's schedule: the database rejects it. The route handlers should still check ownership; this is the second lock.

**Stale writes and versions.** The course list has a `version`. A save sends the version it started from; the server only saves if it still matches, then adds 1. If something else saved in between (another tab), the versions differ and the save is rejected with `409 STALE_WRITE`, which the Import page already handles. The same check makes a double-clicked Save harmless: the second request carries the old version and is rejected instead of adding credits twice.

**Transactions.** Saving a course list means deleting the old rows, inserting the new ones and bumping the version. Do all three in one transaction, so a failure halfway leaves the old list untouched instead of half a list.

**Account deletion that never lies.** Deletion has two parts that can fail separately: the database (one `DELETE FROM profiles`, cascade does the rest) and Clerk (an API call). `account_deletions` records each part's completion time, attempts and last error. The app only tells the student "deleted" when both are done; otherwise it retries. That's #6 step 8 and the Settings page's "wasn't fully deleted" message.

## Catalog tables (`catalog`)

Each mirrors a file in `data/`, column for column where possible:

| Table | Source | Key |
|---|---|---|
| `courses` | `data/catalog/courses.csv` | `id` (`cop3502c`) |
| `requisites` | `data/catalog/requisites.csv` | `course_id, kind` |
| `programs` | `data/programs/programs.csv` | `id` (`uglas-csc_bs`) |
| `requirement_groups` | `data/programs/requirements.csv` | `program_id, group_key` |
| `tracking_milestones` | `data/programs/milestones.csv` | `program_id, semester, position` (position = the row's order within its program and semester in the CSV, from 1; rows can repeat word for word) |
| `model_plan_courses` | `data/programs/plans.csv` | `program_id, semester_index, position` |
| `terms` | `data/soc/terms.csv` | `term` |
| `sections` | `data/soc/sections/<term>.csv` | `term, class_number` |
| `exam_awards` | `data/exam_credit/awards.csv` | `id` |
| `professor_ratings` | `data/rmp/professors.csv` | `rmp_id` |
| `instructor_matches` | `data/rmp/instructor_ratings.csv` | `instructor_name` |

### Loading the catalog (step [11])

`tools/db/load_catalog.py` loads the CSVs into these tables. It was first run on 2026-11-19; everything except the two RMP tables is loaded.

```bash
python3 tools/db/load_catalog.py                    # every table
python3 tools/db/load_catalog.py courses sections   # only these
python3 tools/db/load_catalog.py --dry-run          # write the SQL to tools/db/out/, send nothing
```

- **Safe to re-run.** Each table is upserted, then rows no longer in the CSV are deleted (per term for `sections`). A re-run with unchanged data writes nothing, and ids stay stable (#8 acceptance criterion). An empty CSV stops the load instead of emptying the table.
- **How it connects.** Through `supabase db query --remote`, using your Supabase CLI login and the linked project (`supabase login`, then `supabase link`). No password or key needed. If `SUPABASE_DB_URL` is set, it uses `psql` with that URL instead.
- **Batches.** The CLI rejects requests over ~1 MB, so rows go in batches of ~800 KB (about 80 for `sections`). Each batch is its own transaction; if one fails, the load stops there and a re-run picks up the rest.
- **Checks.** After each table it compares the database's row count with the CSV. Two different CSV rows with the same key stop the load; exact repeats are dropped.
- **RMP.** `professor_ratings` and `instructor_matches` are skipped until `data/rmp/` exists (PR #24). Then: `python3 tools/db/load_catalog.py professor_ratings instructor_matches`.
- **CSV formats it converts:** `|`-separated lists (`gen_ed`, `instructors`, `course_ids`, ...), JSON columns and JSON lists (`tree`, `mentions`, `logic`, `eligible_course_ids`, `slots`, `pool`), `True` / `False` booleans, and empty strings as `NULL`. `tracking_milestones.position` is numbered from the CSV order.

## Setting up Supabase (step [3])

**Already done for the team project (2026-11-19):** the schema was applied with `supabase db push --remote`, and the project's GitHub integration deploys new migrations when they merge to `main`. So change the schema only by adding a new file to `supabase/migrations/`; never edit an applied migration or create tables in the dashboard. The steps below are for setting up a fresh project.

1. **Get access first.** Ask Haadi whether to use an existing GatorAdvisor Supabase project or create one. #6 says not to create parallel projects.
2. **Create or open the project** at supabase.com. Pick the US East region (closest to UF).
3. **Apply the schema:** Dashboard → SQL Editor → paste `supabase/migrations/20261118120000_initial_schema.sql` → Run. (With the Supabase CLI: `supabase link --project-ref <ref>`, then `supabase db push --remote`; without `--remote` it targets a local Docker database.) The migration grants the service role access to the `catalog` schema; Supabase only sets that up for `public` on its own. If the server uses `supabase-js` (not a direct Postgres connection), also add `catalog` under Project Settings → API → Exposed schemas.
4. **Optional dev data:** paste `supabase/seed.sql` into the SQL Editor after replacing `user_dev_student` with your Clerk test user's id. You get the same student the mocks show.
5. **Copy two values** from Project Settings → API into `.env.local`:

   ```bash
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service role key>   # server only, full access
   ```

   Never prefix these with `NEXT_PUBLIC_`: that would ship them to every browser. Add both names (with empty values) to `.env.example` once PR #22, which creates that file, is merged.
6. **Don't use the anon key or Supabase Auth.** Clerk handles sign-in; the browser never talks to Supabase directly.

## Testing it locally

GitHub runs this automatically on every PR that touches `supabase/` (`.github/workflows/schema.yml`): it applies the migration and `seed.sql` to a temporary Postgres, then runs the checks. To run it yourself: `supabase/tests/schema_checks.sql` seeds two students and checks 19 things: cross-student inserts are rejected, bad values and duplicate sections are refused, the server role can read and reload catalog without duplicates, deletes cascade to every private table and only for that student, deleted students can't get data back, and a browser role reads nothing. With a local Postgres:

```bash
createdb gator_test
psql -d gator_test -v ON_ERROR_STOP=1 -f supabase/tests/supabase_roles.sql   # Supabase's roles; never run on Supabase
psql -d gator_test -v ON_ERROR_STOP=1 -f supabase/migrations/20261118120000_initial_schema.sql
psql -d gator_test -f supabase/tests/schema_checks.sql      # ends with "ALL CHECKS PASSED"
dropdb gator_test
```

## Open questions

- **Shaun:** do the academic fields work for the engine? Especially `profiles.entry_term` (required) for tracking semesters, `coursework` as one row per attempt, and whether the engine wants a `transfer_equivalencies` table.
- **AI team:** is `chat_messages.sources` (JSON) enough for citations, and does `recommendation_events` cover the feedback #11 needs?
- **Everyone:** the course code format. Coursework uses `COP3502C`; the catalog uses `cop3502c`. Converting is uppercasing, but one shared helper should do it everywhere (Haadi's question 1 on #8).
