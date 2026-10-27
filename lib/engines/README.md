# Academic engines

Deterministic rules for degree audits, course eligibility, Critical Tracking
and planning (issue #8). The AI layer explains these results and the frontend
renders them. Neither recomputes them, and the AI never decides eligibility
on its own.

**Status: checkpoint 1 (contracts).** The JSON shapes, their runtime
validation, the catalog loader and hand-built examples are here. The engines
that produce the results come next (checkpoint 2: audit, eligibility,
tracking; checkpoint 3: planner, what-if). Build against the examples now; the
engines will return the same shapes.

## Layout

```
lib/engines/
  schemas/      zod schemas + inferred types (import from "lib/engines/schemas")
    common.ts   ids, Term, SourceReference, Reason codes, ResultVersions
    catalog.ts  the scraped catalog as the engine reads it (engine input)
    record.ts   AcademicRecord: one student's facts (engine input)
    results.ts  AuditResult, EligibilityResult, TrackingResult (engine output)
    plan.ts     Plan, RequirementSlot (engine output; draft)
  status.ts     status vocabularies and the rules that combine them
  catalog/      CSV reader and loader: data/*.csv -> validated Catalog
  examples/     synthetic record + one example of every result type
  __tests__/    vitest
```

The engine is framework-free TypeScript: no React, no Next.js, no clock, no
network. Only `catalog/load.ts` touches the filesystem, and Maria's data layer
will replace it.

## Commands

```
npm install
npm test                  # vitest: catalog load, schemas, examples
npx eslint lib/engines
```

`npm test` loads the full catalog from `data/` (483 programs, ~9,900 courses,
444 exam awards) and validates every row, so a scraper change that breaks the
contract fails here.

## Using the schemas

```ts
import { AuditResult, AcademicRecord } from "@/lib/engines/schemas";

const record = AcademicRecord.parse(json);      // throws with a precise path
const check = AuditResult.safeParse(response);  // { success, data | error }
```

Every schema exports a type with the same name (`AuditResult` is both). The
objects are strict: an unknown or misspelled field is an error, not silently
dropped.

Each result schema also checks its own logic. A result whose status
contradicts its numbers (for example, "satisfied" with 5 of 8 credits) fails
validation, so a bug can't reach a student looking valid.

## Statuses

### Requirement and program (`AuditResult`)

| status | meaning |
|---|---|
| `satisfied` | Met by **completed** work alone. |
| `in_progress` | Met only if currently enrolled courses are passed. |
| `not_satisfied` | Short even counting current enrollment. |
| `unknown` | Can't be decided from the data and record; `reasons` say why. |

Completed and enrolled work are always kept apart: `completed` and
`appliedCourses` hold finished courses; `inProgress` and `pendingCourses`
hold current ones.

The program's `overallStatus` is the worst status among requirements with
`countsTowardDegree: true`, ranked `not_satisfied` > `unknown` > `in_progress`
> `satisfied`. A definite "not met" outranks "can't tell" because it's still
true and more useful. A program with `programStatus: "needs_review"` is never
better than `unknown`: its requirements couldn't be verified from the catalog.
Show a warning for it.

Requirements in section `options` (alternative routes, approved lists) show
progress but never block the degree.

### Eligibility (`EligibilityResult`)

| status | meaning |
|---|---|
| `eligible` | Requisites met by completed work. |
| `eligible_pending` | Met only if current courses are passed (UF allows registering with prerequisites in progress). |
| `not_eligible` | A requisite is definitely unmet. |
| `unknown` | Can't be decided. **Never treat as eligible.** |

Prerequisite trees are evaluated with four values (`met`, `pending`,
`not_met`, `unknown`). AND takes the worst child, so one missing course
settles it even if another branch is unknown. OR takes the best child, so one
route that will be met is enough. Leaves that can't be decided from a record
are `unknown`: instructor permission, placement scores, "or equivalent", and
text the parser couldn't read.

### Critical Tracking (`TrackingResult`)

Per milestone: `met`, `pending` (met if current courses pass), `upcoming`
(not yet met, semester still ahead), `not_met` (due and missed), `unknown`
(due and can't be checked). The program's `status` uses the issue's four
words:

| status | meaning |
|---|---|
| `met` | Every milestone due so far is met. |
| `at_risk` | A due milestone rests on current courses. |
| `not_met` | A milestone was missed. |
| `unknown` | A due milestone can't be checked. |

Semesters count enrolled fall/spring terms (summers don't count, as in UF's
tracking language). Upcoming milestones don't affect the status: being in
semester 3 with a semester-5 course untaken is normal.

## Reasons, caveats and sources

`reasons` explain a status; `caveats` say what was **not** checked at all. The
advisor should mention caveats whenever it reports a status. Every reason has
a machine `code` and a human `message`.

| code | meaning |
|---|---|
| `program_needs_review` | The program's data couldn't be verified from the catalog. |
| `rule_not_modeled` | The catalog states the rule in prose the data doesn't encode. |
| `missing_grade` | A completed attempt has no grade, and the rule needs one. |
| `missing_input` | The record lacks a fact the rule depends on (e.g. AA degree). |
| `unknown_course` | A course id isn't in the catalog or the Schedule of Courses. |
| `requisite_unparsed` | Prerequisite text the parser couldn't read. |
| `requisite_unverifiable` | Parsed, but needs judgment or data we don't have (permission, placement, "or equivalent"). |
| `requirements_remaining` | Requirements still unmet after counting current courses. |
| `in_progress_pending` | Met if current courses are passed. |
| `requisite_not_met` | A requisite is definitely unmet. |
| `count_rule_unmet` | Enough credits, but a rule like "at least one 4000-level" fails. |
| `counted_elsewhere` | The course already counts toward another requirement. |
| `waived` / `substitution_applied` / `overlap_allowed` | An advisor exception from the record applied. |
| `offering_unconfirmed` | A planned course isn't in a published schedule for that term. |
| `credit_cap` / `prerequisite_chain` / `deadline_unreachable` / `locked_conflict` | Planner blockers. |
| `program_rules_not_captured` | Caveat: page prose rules (residency, upper-division credits, exclusivity) not checked. |
| `grade_minimums_not_checked` | Caveat: requirement-level minimum grades aren't in the program data. |
| `gpa_rule_not_captured` | Caveat: a GPA threshold that's only in text. |

`SourceReference` points at the evidence: catalog URL, catalog year, fetch
time and, for program pages, the fingerprint of the requirement tables (it
changes when UF edits them). Record entries are cited by id
(`evidenceId: "a05"`).

## Versions

Every result carries `versions`:

- `contractVersion`: these shapes (`0.1.0`).
- `engineVersion`: the rules implementation.
- `dataVersion`: sha256 of the nine catalog CSVs (first 16 hex). It changes
  exactly when the data changes.
- `catalogYear`: the catalog year the student is held to.
- `recordId` / `recordVersion`: the record evaluated.

When any of these change, a stored result is stale.

## The record

`AcademicRecord` holds facts only. Plans and what-ifs are separate inputs, so
evaluating them can't change saved data. Notable rules (UF grading policy,
https://catalog.ufl.edu/UGRD/academic-regulations/grades-grading-policies/):

- One row per **attempt**. A repeat is a new row; UF counts every attempt's
  grade in the GPA and awards the credit once.
- Transfer and dual-enrollment grades are never averaged into the UF GPA.
- `status: "in_progress"` only in `currentTerm`. A withdrawal is `completed`
  with grade `W`.
- `currentTerm` replaces the clock: the same record always gives the same
  answer.
- `facts` fields that are absent mean "not known" (`missing_input`); `false`
  means "known not".
- Exceptions (substitution, waiver, allowed overlap) apply only when written
  in the record.

## Examples

All built from one synthetic student (`examples/record.json`): a Psychology
BS (Behavioral and Cognitive Neuroscience) major with a Geology minor in
Fall 2026, their third semester. They have a repeated course (BSC 2010: D,
then B), a withdrawal, a dual-enrollment course, AP credit and four courses
in progress.

| file | shows |
|---|---|
| `audit.geology-minor.json` | all three rule types; satisfied, in_progress and not_satisfied; a course on two lists counted once; prose rules as caveats; UF cumulative GPA |
| `audit.english-minor-needs-review.json` | a `needs_review` program: everything `unknown`, with why |
| `eligibility.json` | every eligibility status: a met OR, a pending prerequisite, a program restriction that settles an AND, "or equivalent", unparsed text |
| `tracking.psychology-bs.json` | Critical Tracking in semester 3, with GPA thresholds not yet captured |
| `plan.geology-minor.json` | a one-term plan with a confirmed Spring 2027 offering (draft shape) |

`__tests__/examples.test.ts` checks every claim in them against the real
data: course and program ids, requirement definitions, record evidence,
one-course-one-requirement, the GPA arithmetic, requisite trees and the
published schedule.

## Known limitations (checkpoint 1)

- The engines don't exist yet; the examples are hand-built to the contract.
- Requirement-level minimum grades aren't in the program data
  (`grade_minimums_not_checked`). **Prerequisite** minimum grades are: 2,216
  requisite leaves carry `min_grade`.
- Page prose rules (UF residency credits, upper-division minimums, credits
  exclusive to a minor) aren't captured (`program_rules_not_captured`).
- Critical-tracking GPA thresholds exist only in milestone text, and
  milestones worded incrementally ("1 more", "the final") are stored per
  semester rather than cumulatively (see the Psychology example).
- Class standing (freshman ... senior) isn't modeled; standing leaves
  evaluate `unknown`.
- Summer sessions A/B/C aren't distinguished. The plan's 18-credit cap is a
  default to verify against UF's registration policy.
- 29 of 483 programs are `needs_review` and audit as `unknown`.
- Persistence, record versions and invalidation come from the backend data
  layer (Maria, TEAM-01); nothing here writes to a database.
