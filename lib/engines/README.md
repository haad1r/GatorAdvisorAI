# Academic engines

Deterministic rules for degree audits, course eligibility, Critical Tracking
and planning (issue #8). The AI layer explains these results and the frontend
renders them. Neither recomputes them, and the AI never decides eligibility
on its own.

**Status: checkpoints 1 to 3, engine side.** Contracts, eligibility, the
degree audit, Critical Tracking, requirement flags and the candidate filter
for recommendation scoring, the semester planner, plan validation and
what-if (audit, tracking and plans) are here, behind one API (`index.ts`).
Database integration (Maria, TEAM-01) and the section scheduler's use of the
same eligibility calls are the remaining integration steps. See
[Readiness](#readiness) at the end.

## The API

```ts
import { createAcademicEngine } from "@/lib/engines";
import { loadCatalog } from "@/lib/engines/catalog/load"; // Node only (reads data/)

const engine = createAcademicEngine(loadCatalog("data"));
```

| call | answers | returns |
|---|---|---|
| `engine.audit(record)` | What have I done and what is left? Every declared program, credit earned / in progress, labelled GPAs, courses counting twice, everything unknown. | `StudentAudit` |
| `engine.eligibility(record, course, term?)` | Can I take this course? Requisites, plus already taken and offered that term. `term` defaults to the next fall or spring. | `EligibilityResult` |
| `engine.requirementFlags(record, courses)` | Does each course fill an open requirement / an open major requirement? Read off the audit. | `RequirementFlags` |
| `engine.filterCandidates(record, courses, term?)` | Which courses may be recommended at all (eligible, not held, offered)? | `CandidateFilter` |
| `engine.tracking(record)` | Am I on track? Every declared program with milestones, deadline terms, the next deadline. | `StudentTracking` |
| `engine.generatePlan(record, options)` | What should I take, and when? Terms, why each course is there, feasible or not and what blocks it, what it couldn't place, what it assumes. | `Plan` |
| `engine.regeneratePlan(record, plan, changes?)` | The same, keeping every lock of an earlier plan. | `Plan` |
| `engine.validatePlan(record, planOrDraft)` | Can this plan (generated, or made by a student or advisor) work as written? | `PlanCheck` |
| `engine.whatIf(record, change, plan?)` | What if I add, drop or switch programs? On a copy; the saved record and plan are never touched. With plan options, also a scenario plan and the difference. | `WhatIfResult` |
| `engine.auditProgram(record, id)`, `engine.trackingForProgram(record, id)` | One program only. | `AuditResult`, `TrackingResult` |

Every call validates the record (a malformed one throws a `ZodError` naming
the field), and every result is validated before it is returned. Plain
functions: no UI, no clock, no network, no database writes. The same
functions are exported individually (`auditStudent`, `requirementFlags`, ...)
for callers that hold a `CourseHistory`.

| engine | entry point | question it answers | docs |
|---|---|---|---|
| course eligibility | `evaluateEligibility` in `eligibility.ts` | Can this student take this course in this term? | [Eligibility](#eligibility) below |
| degree audit | `auditProgram` in `audit/` | How far through this program is the student? | [audit/README.md](audit/README.md) |
| Critical Tracking | `evaluateTracking` in `tracking.ts` | Is the student on track for the program's semester milestones? | [Critical Tracking](#critical-tracking) below |
| student-wide audit / tracking | `auditStudent`, `trackStudent` in `student.ts` | Every declared program at once | [The API](#the-api) |
| flags and filter | `requirementFlags`, `filterCandidates` in `flags.ts` | Inputs to recommendation scoring | [Recommendation scoring](#recommendation-scoring) below |
| offerings | `offeringOf` in `offering.ts` | Is this course offered in this term? | [Offerings](#offerings) below |
| planner | `generatePlan` in `planner.ts` | A term-by-term plan | [Planner](#planner) below |
| plan validation | `validatePlan` in `validate.ts` | Does this plan work? | [Plan validation](#plan-validation) below |
| what-if | `whatIf` in `whatif.ts` | The audit, tracking and plan under other programs | [What-if](#what-if) below |

### Course ids

Course ids are lowercase, no space, **with** the suffix letter:
`cop3502c`, `chm2045l`. That is the key every CSV joins on. The suffix
can't be dropped, because `chm2045` and `chm2045l` are different courses.
Inputs may use any spelling: `toCourseId("STA 3100")`, `"STA3100"` and
`"sta3100"` all give `"sta3100"`. It is the same rule as the scraper's
`ids.code_to_id`. `toDisplayCode("cop3502c")` gives `"COP 3502C"`.
`parseCourseId` returns null instead of throwing.

### Recommendation scoring

Scoring (`lib/engines/recommendations/scoring.ts`, issue #11) needs two
steps from this engine, kept separate because scoring doesn't filter:

```ts
const term = { season: "spring", year: 2027 };
const filter = engine.filterCandidates(record, codes, term);
const keep = filter.courses.filter((c) => c.decision === "candidate").map((c) => c.courseId!);
const flags = engine.requirementFlags(record, keep);
const courses = flags.courses.map((f) => ({ code: f.code, ...toScoringFlags(f), tags, level }));
```

**`filterCandidates`** decides each course, in input order:

| decision | when |
|---|---|
| `excluded` | already passed or in progress (`already_held`); `not_eligible`; not in the term's complete published schedule (`not_offered`); not a course code or not in the catalog (`unknown_course`) |
| `needs_check` | eligibility `unknown`; offering `unknown` or `not_seen`; a completed attempt with no grade. **Not a candidate** until a person checks. |
| `candidate` | `eligible` or `eligible_pending`, not held, and offered (or offered in past terms of the season). Notes say what it rests on (`in_progress_pending`, `offering_unconfirmed`). |

For the synthetic student, over all 9,870 courses for Spring 2027: 1,564
candidates, 1,234 needs_check, 7,072 excluded. It takes about 300 ms.

**`requirementFlags`** gives, per course, `fillsRequirement` (any open
requirement of a declared program, gen ed included) and `fillsMajorSlot`
(an open requirement in the `major` section of a declared major). Each is
`yes`, `no` or `unknown`:

- `yes`: the audit lists the course as able to fill a requirement that is
  `not_satisfied`.
- `unknown`: it is listed only for requirements the audit can't decide (a
  program under review, a fact the record lacks such as language
  proficiency).
- `no`: no open requirement lists it, or the student already holds it.

The flags come from the audit's own remaining-course lists, the full ones
rather than the first 8. They are not recalculated, so a flag can't
disagree with the audit. `toScoringFlags(f)` maps `yes`/`no`/`unknown` to
`true`/`false`/`null`, preserving unknown for scoring. This changes the helper's
return type; consumers must handle `null` rather than interpreting it as `no`.
`requirements` lists the open requirements behind each flag, for the "why".
Prose slots ("approved elective") list no courses and flag nothing; the
result's caveats count them. For the synthetic student: 283 courses fill
an open requirement, 6 fill an open major slot, 43 are unknown (CLAS
language courses, because proficiency isn't recorded). Takes about 40 ms.

## What the engine is for

The engine is meant to run in the background, behind the advisor. Its
results are the facts the advisor talks about. When the advisor proposes a
course, a plan or "you're on track", the claim is checked against these
results; nothing is recomputed in a prompt. Four properties make that safe:

- **Deterministic.** The same catalog, record and arguments always give the
  same result. The engine reads no clock (`record.currentTerm` is "now"),
  no network and no randomness. Tests check this for every program.
- **Self-checking.** Every result is validated by its zod schema before
  it's returned, including the status logic: a "satisfied" with 5 of 8
  credits can't leave the engine.
- **Honest about gaps.** Anything the data can't decide is `unknown`, with a
  machine `code` and a human `message`. `caveats` list what wasn't checked
  at all. A consumer must never round `unknown` up to a yes.
- **Citable.** Results name their evidence, both the record entries (`evidenceId:
  "a07"`) and the catalog pages (`sources`), and carry `versions`, so a
  stored answer can be detected as stale.

## Layout

```
lib/engines/
  index.ts      createAcademicEngine: the public API (start here)
  schemas/      zod schemas + inferred types (import from "lib/engines/schemas")
    common.ts   ids (toCourseId), Term, term codes, SourceReference, Reason codes, ResultVersions
    catalog.ts  the scraped catalog as the engine reads it (engine input)
    record.ts   AcademicRecord: one student's facts (engine input)
    results.ts  AuditResult, EligibilityResult, TrackingResult (per program / course)
    student.ts  StudentAudit, RequirementFlags, CandidateFilter, StudentTracking, WhatIfResult
    plan.ts     Plan, RequirementSlot, PlanOptions, PlanDraft, PlanCheck
  status.ts     status vocabularies and the rules that combine them
  history.ts    what a record says about courses: grade rules, credit, GPA, already taken
  eligibility.ts  evaluateEligibility: requisite trees -> EligibilityResult
  offering.ts   offeringOf: Schedule of Courses terms -> offered in a term?
  audit/        auditProgram: program + record -> AuditResult (own README)
  tracking.ts   evaluateTracking: milestones + record -> TrackingResult
  student.ts    auditStudent / trackStudent: every declared program
  flags.ts      requirementFlags / filterCandidates: inputs to recommendation scoring
  planner.ts    generatePlan / regenerationOptions: record + options -> Plan
  validate.ts   validatePlan: record + plan -> PlanCheck
  deadlines.ts  Critical Tracking as "these courses by this term" (planner, validator)
  hypothetical.ts  the record at the start of a future term, planned courses assumed passed
  whatif.ts     whatIf: audit + tracking + plans on a modified copy of the record
  versions.ts   the versions block results carry
  catalog/      CSV reader and loader: data/*.csv -> validated Catalog
  examples/     synthetic record + one example of every result type
    fixtures/   three hand-checked students (issue step 10; own README)
  __tests__/    vitest
```

The engine is framework-free TypeScript: no React, no Next.js, no clock, no
network. Only `catalog/load.ts` touches the filesystem, and Maria's data layer
will replace it.

## Commands

```
npm install
npm test                  # vitest: catalog, schemas, examples, engines, fixtures, whole-catalog sweep (~8 s)
npx eslint lib/engines
```

`npm test` loads the full catalog from `data/` (483 programs, ~9,900 courses,
444 exam awards) and validates every row, so a scraper change that breaks the
contract fails here.

## Using the engines

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

### Eligibility

```ts
import { evaluateEligibility } from "@/lib/engines/eligibility";

const result = evaluateEligibility(catalog, record, "gly4043", { season: "spring", year: 2027 });
// result.status: "eligible_pending"; result.prerequisite is the evaluated tree

// Courses taken in the same term satisfy corequisites (as pending):
evaluateEligibility(catalog, record, "chm2045", term, { concurrent: ["chm2045l"] });
```

The term must be after the record's `currentTerm` (`engine.eligibility`
defaults it to the next fall or spring). Evaluating many courses for one
record? Build one `new CourseHistory(record, catalog)` and pass it as the
last argument. The whole catalog takes about 150 ms.

`status` is about requisites only. Two facts are reported beside it and
never change it:

- `taken`: `passed` (a passing attempt or exam credit), `in_progress`,
  `no_grade` (completed, grade missing), `not_passed` (every attempt failed
  or withdrawn, so a retake is possible) or `none`, with the record entries.
- `offering`: whether the course is offered that term; see
  [Offerings](#offerings).

The candidate filter combines all three.

How leaves are decided:

| leaf | rule |
|---|---|
| course | Best holding: a completed attempt meeting `min_grade` (any passing grade without one, D included) is met, an in-progress one pending, a completed one with no grade unknown. Exam credit counts as met. A failed first attempt doesn't block a passed repeat. |
| credits | Earned credit (each course once) filtered by prefixes / list / level; unfiltered counts elective credit too. A `subject` ("credits of history") is unknown. |
| program | A code (`HES_BHS`) is compared with declared programs, ignoring track numbers and the UF Online suffix; a code no catalog program has is unknown. A name is met only on an exact match, otherwise unknown (names come from prose and are often fragments). |
| gpa | No scope: the UF cumulative GPA. A scope ("upper division") is unknown. |
| standing | Credits earned against UF's classification: sophomore 30, junior 60, senior 90 ([Student Classifications](https://catalog.ufl.edu/UGRD/academic-regulations/student-classifications/)). Earned credit is each course once (transfer included, which UF accepts "as hours earned"), exam credit (an assumption: the page doesn't say) and elective credit. Met on completed credit, pending if current courses would reach it, unknown if an ungraded course would decide it. "Junior standing" means junior or higher; no requisite in the data sets a ceiling. |
| permission, placement, equivalent | Unknown (`requisite_unverifiable`). |
| unparsed | Unknown (`requisite_unparsed`). |

### Offerings

`offeringOf(catalog, courseId, term)` reads only the Schedule of Courses
terms the scraper read (Fall 2021 to Spring 2027, `catalog.schedule`):

| status | meaning |
|---|---|
| `confirmed` | In that term's published schedule. |
| `not_scheduled` | That term's schedule was read completely and the course isn't in it. For a term that isn't closed, the message gives the snapshot date, because UF can still add sections. |
| `historical` | The term isn't published; the course ran in that season before (`seenInSeason`). **An assumption, never a confirmation.** |
| `not_seen` | The term isn't published; the course ran in no term of that season that was read. |
| `unknown` | The term was only partly read (Spring 2022: UF's server failed mid-scrape), or no term of that season was read. |

### Critical Tracking

```ts
import { evaluateTracking } from "@/lib/engines/tracking";

const t = evaluateTracking(catalog, record, "uglas-psy_bs01");
// t.currentSemester: 3; t.status: "unknown" (a due GPA rule can't be checked)
// t.milestones[i]: one result per catalog milestone, in the page's order
```

It throws `RangeError` for a program with no milestones (every minor and
certificate, and 9 majors whose pages have no tracking tab). Check
`catalog.programs[id].milestones.length` first.

**Semesters.** `currentSemester` counts fall and spring terms from
`record.firstTerm` through `record.currentTerm`. Summers don't count, as in
UF's tracking language, and a student who starts in summer is in semester 1.
Continuous enrollment is assumed. A milestone is **due** when its semester is
the current one or earlier. Each milestone's `dueTerm` is its semester as a
calendar term under the same assumption, and `nextDeadline` is the earliest
semester, this one or later, with a milestone not met (null when everything
is met). For the synthetic student that's semester 3, Fall 2026: a count
resting on current courses and an unchecked GPA rule.

**Checked as of today.** Milestones are judged against the record as it
stands now, not as it stood when each semester ended. A course finished a
semester late counts as met. The question answered is "is this student on
track now?", which is what an advisor acts on. (UF itself reviews tracking at
the end of each term.)

How each kind of milestone is decided:

| kind | rule |
|---|---|
| `courses` | Every slot held. A slot is a list of " or " alternatives, and each alternative is an AND-set (a lecture and its lab). An alternative is met when all its courses are passed at the line's `minGrade`, and pending when that rests on courses in progress. |
| `count` | At least `required` slots held, counting completed work first: met, then pending, then unknown (a completed course with no grade). With no slots listed, the pool is the model plan's tracking courses scheduled up to that semester; a lab joins its lecture, and the plan's "or" choices make one slot. |
| `gpa`, scope `uf` | The UF cumulative GPA (`history.ts`) against `gpa.min`. Met once due and at or above it. Below it, due this semester, and grades still to come: `pending` (it rests on this term). Below it and past: `not_met` (`gpa_below_minimum`). A later semester's GPA is `upcoming` either way, because it can still change. |
| `gpa`, other scopes | `unknown` when due, `upcoming` before (`gpa_rule_not_checked`). Critical-tracking, upper-division and program GPAs use course sets and attempt rules that differ by page ("all attempts", "best of two attempts", "excluding ECO 3101"). The threshold is still reported in `gpa.min`. |
| `note` | Prose ("2 of the remaining PSY 3XXX/4XXX courses"): `unknown` when due. |

Anything not yet met whose semester is still ahead is `upcoming`, whatever
the reason.

**Minimum grades.** `minGrade` comes from the line itself ("with a minimum
grade of C"). A minimum of `S` means S, or C or better (UF: "a grade of S is
equal to a C (2.0) or better"). A grade the page gives to one course inside
a line is not applied to the others ("( ACG 2071 must be completed with a
minimum grade of B)"). Those are left unchecked, and the result carries the
`grade_minimums_not_checked` caveat.

**A milestone weaker than an earlier one isn't trusted.** UF states tracking
cumulatively, so a later milestone over the same courses never asks for
fewer. Psychology BS01's semester 3 asks for 2 of BSC 2010, PSB 3340 and PSY
3213L. Its semester 4 says "1 tracking course from" those plus STA 2023,
which the data stores as 1 of 4. UF meant one *more*, and semester 5's
"the final tracking course" means all four. Read as stored, completed work
would always meet them. So a milestone that demands fewer slots than an
earlier one whose courses it contains is `unknown` when due (`upcoming`
before), with a `rule_not_modeled` reason naming the earlier semester. It
stays `not_met` if even the weak reading fails. Across the catalog this
fires only on those two Psychology lines.

Evaluating many programs for one record? Pass one `CourseHistory` as the
last argument. All 224 programs with milestones take about 50 ms.

### GPA

Every GPA is labelled by kind. A GPA is computed only where a source says
which courses and attempts count:

| kind | computed? | rule |
|---|---|---|
| `uf_cumulative` | yes | UF grading policy: UF attempts only (transfer and dual-enrollment grades are never averaged in), **every** attempt of a repeat, only grades that carry points (A through E, WF, I, NG). Credit for a repeated course is earned once. |
| `upper_division` | no (`unknown`) | No catalog policy in the data defines it, and the program pages that use it disagree. One tracking line says "all courses taken after the student earned 60 credits"; the other 160 give no definition. |
| `major` | no | Each program sets which courses count, and the program data doesn't list them. |
| `critical_tracking` | no | Courses and attempt rules differ by program ("best of two attempts"). The tracking result reports each threshold. |

`StudentAudit.gpa` holds the student-wide kinds (`uf_cumulative`,
`upper_division`); each program's `AuditResult.gpa` holds all four. Credit
is kept apart the same way: `credits.earned` (completed and exam credit,
each course once, plus elective credit) and `credits.inProgress` (current
enrollment, not earned until graded). An audit's `totals.remaining` is the
credit still to take after current courses pass.

### Planner

```ts
const plan = engine.generatePlan(record, {
  targetTerm: { season: "spring", year: 2029 },   // last planned term
  creditCap: 15,                                  // default 15 (a planner default, not a UF rule)
  locks: [{ course: "STA 3024", term: { season: "spring", year: 2027 } }],
  prefer: rankedCodes,                            // e.g. the recommendation ranking
});
const again = engine.regeneratePlan(record, plan, { creditCap: 12 }); // locks kept
```

Options also take `startTerm` (default: the next fall or spring),
`termCaps`, `summer` (default false), `lockedTerms` (nothing is added to
them), `programIds` and `assumedTermLoad` (below).

**How it plans** (`planner.ts`, deterministic, greedy):

1. **Slots.** Each declared program is audited. Every requirement still
   open becomes `RequirementSlot`s from what the audit says it still
   needs: a fixed course, a choice among courses, N credits from a pool,
   or hours for a prose row ("approved elective", planned as a
   placeholder). Slot ids are stable across regenerations.
2. **Choose** a course per slot. Locks come first, then fixed courses, then
   choices (fewest options first), then credit pools (broad pools last).
   As in the audit, a course fills one slot per program and counting
   domain, but it may serve a major slot and a gen ed slot at once.
   Candidates are ranked: no impossible prerequisite, already chosen for
   another slot, in the `prefer` list, listed by the most open slots, fewest
   prerequisite credits to add, in the program's model plan, offered
   before, lower level, id. A language sequence stays in one language.
3. **Close** over prerequisites and corequisites (the cheapest route
   through each tree is added, `why: "prerequisite"` / `"corequisite"`)
   and over Critical Tracking. Open milestones become deadlines: "7 of
   these 8 by semester 7" takes the slots that can be finished soonest.
   Deadlines flow down prerequisite chains.
4. **Schedule** term by term: locked courses where the student put them,
   then every course whose requisites are met on the record as it would
   stand then, that is offered (or was offered that season before), and
   that fits the cap. The earliest deadline goes first, then the course
   that unlocks the most others.
5. **Check** the result with `validatePlan`. Every error it finds is a
   blocker, so the planner can't call a plan feasible that the validator
   rejects (tested on every program in the catalog).

**Eligibility in future terms** comes from the one eligibility engine, run
on a *hypothetical record* (`hypothetical.ts`): the record at the start of
that term, with current and earlier planned courses entered as passed. They
are entered as transfer-style attempts with an A, so they meet any minimum
grade but never enter the UF GPA. For class standing, each planned fall or
spring term counts as at least `assumedTermLoad` credits (default 12, UF's
full-time load), because a plan names only requirement courses and the rest
of a load is free electives. Both assumptions are stated in every plan's
`assumptions`.

**What a plan says:**

| field | |
|---|---|
| `status` | `feasible` only with no blocker, no unplaced slot and no unplaced course |
| `terms[].courses[]` | `why` (requirement / prerequisite / corequisite / tracking / locked / placeholder), `slotIds` (the requirements it fills), `deadline` (a tracking deadline it serves), `offering` (confirmed / historical / unconfirmed), `locked`, `notes` (what the placement rests on: an unverifiable prerequisite, a variable-credit course at its minimum, an unconfirmed offering) |
| `slots` | every slot the plan had to fill, the "why" a course points at |
| `unplacedSlots`, `unplacedCourses` | what couldn't be placed, each with a reason |
| `blockers` | the binding constraints: `credit_cap`, `prerequisite_chain`, `not_offered`, `deadline_unreachable` (including a milestone already missed, which no plan can fix), `locked_conflict`, `requirements_remaining` |
| `assumptions` | passing grades, unconfirmed offerings, the assumed term load, requirements that can't be planned, programs under review |
| `options` | the options it was made with, so it can be regenerated |

**Locks survive regeneration.** `regeneratePlan` (or `regenerationOptions`)
keeps the old plan's `options.locks`, every course marked `locked`, and
every `locked` term exactly as it was. A lock that breaks a rule (its
prerequisites aren't met by then, the term's schedule lacks it, it's over the
cap) stays where it was put and makes the plan infeasible with a
`locked_conflict` blocker. The planner never moves it.

### Plan validation

```ts
engine.validatePlan(record, plan);   // a generated Plan
engine.validatePlan(record, { terms: [{ term, courses: ["MAR 3023", "GEB 3373"] }], creditCap: 18 });
```

Checks any plan with the same engines. It finds terms not after the current
term or out of order, unknown course codes, a course planned twice, a
course already passed (a warning: a repeat), terms over `creditCap`,
requisites not met in their term (earlier planned courses assumed passed,
same-term courses counted for corequisites), courses not in a term's
complete published schedule (an error) or not seen that season (a warning),
open Critical Tracking milestones not covered by their term, and
requirements still unmet once the whole plan is passed. `valid` means no
error. `programsAfter` gives each program's status once the plan is
passed.

### What-if

```ts
engine.whatIf(record, { add: ["uglas-gpy_umn"], remove: ["uglas-gly_umn"] });
engine.whatIf(record, { programs: [{ programId: "uglas-psy_bs02" }] });
```

The change is applied to a deep copy whose `recordVersion` becomes
`"<version>+what-if"`, so a scenario result can't be cached as the real
record's. The result has `baseline` and `scenario` program summaries
(status, credits applied / in progress / remaining, requirement counts,
tracking status), the full scenario audit and tracking, and
`diff: { added, removed, changed }`. A test freezes the record and checks
it's byte-identical afterwards. A `catalogYear` other than the loaded
catalog's throws, because only 2026-27 data exists.

With plan options, `whatIf(record, change, { options, saved })` also plans
the copy (`basis: "what_if"`, same options and locks) and compares it with
the saved plan, or with one generated for the record: `plans.diff` gives
both statuses, planned credits, the last term with a course, and the
courses added and dropped. The saved plan is returned as given (a validated
copy), never modified.

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

The status is decided in that order: any `not_met` milestone gives
`not_met`, then any due `unknown` gives `unknown`, then any due `pending`
gives `at_risk` (`combineMilestones` in `status.ts`). Upcoming milestones
don't affect it: being in semester 3 with a semester-5 course untaken is
normal. How each milestone is decided is in
[Critical Tracking](#critical-tracking) above.

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
| `listed_twice` | The program lists the same required course in two of its requirements; one course counts for both (7 programs, 12 courses). |
| `gpa_below_minimum` | A GPA the engine computed (the UF cumulative GPA) is below a milestone's threshold. |
| `already_held` | The student already passed or is enrolled in the course (flags, candidate filter). |
| `not_offered` | Not in the term's complete published Schedule of Courses (candidate filter). |
| `offering_unconfirmed` | A planned course isn't in a published schedule for that term. |
| `credit_cap` / `prerequisite_chain` / `deadline_unreachable` / `locked_conflict` | Planner blockers (see [Planner](#planner)). |
| `term_out_of_range` / `duplicate_course` | Plan validation: a term not after the current one or out of order; a course planned twice. |
| `program_rules_not_captured` | Caveat: page prose rules (residency, upper-division credits, exclusivity) not checked. |
| `grade_minimums_not_checked` | Caveat: a minimum grade the data doesn't carry (requirement-level grades; a tracking grade given to one course in a line). |
| `gpa_rule_not_checked` | A GPA threshold the engine reports but doesn't compute (critical-tracking, upper-division, program GPAs). |

`SourceReference` points at the evidence: catalog URL, catalog year, fetch
time and, for program pages, the fingerprint of the requirement tables (it
changes when UF edits them). Record entries are cited by id
(`evidenceId: "a05"`).

## Versions

Every result carries `versions`:

- `contractVersion`: these shapes (`0.2.0`: added the API's student-level
  results, `taken`/`offering` on eligibility, `dueTerm`/`nextDeadline` on
  tracking, `totals.remaining` and all four GPA kinds on the audit).
- `engineVersion`: the rules implementation.
- `dataVersion`: sha256 of the ten catalog CSVs (first 16 hex, now including
  `soc/terms.csv`). It changes exactly when the data changes.
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
- `firstTerm` is the first term of **college** enrollment: a transfer
  student's first term at the previous school (UF tracking counts their
  semesters there). For an admitted student who hasn't started, it can come
  after `currentTerm` (semester 0: nothing is due yet), which is how an
  incoming freshman is planned.

## Examples

Built from the synthetic student in `examples/record.json`: a Psychology
BS (Behavioral and Cognitive Neuroscience) major with a Geology minor in
Fall 2026, their third semester. They have a repeated course (BSC 2010: D,
then B), a withdrawal, a dual-enrollment course, AP credit and four courses
in progress.

| file | shows |
|---|---|
| `audit.geology-minor.json` | all three rule types; satisfied, in_progress and not_satisfied; a course on two lists counted once; prose rules as caveats; labelled GPAs |
| `audit.english-minor-needs-review.json` | a `needs_review` program: everything `unknown`, with why |
| `eligibility.json` | every eligibility status: a met OR, a pending prerequisite, a program restriction that settles an AND, "or equivalent", unparsed text; already taken and offerings |
| `tracking.psychology-bs.json` | Critical Tracking in semester 3: met course and UF GPA milestones, a count resting on current courses, an unchecked critical-tracking GPA, two incremental lines not trusted, prose notes, deadline terms |
| `plan.psychology-geology.json` | a feasible plan through Spring 2029 from the planner: a locked course, gen ed shared with the major, prerequisites in order, tracking deadlines, placeholders for prose electives, stated assumptions |
| `fixtures/` | three hand-checked students across three program structures (below) |

`__tests__/examples.test.ts` checks every claim in them against the real
data: course and program ids, requirement definitions, record evidence,
one-course-one-requirement, the GPA arithmetic, requisite trees and the
published schedule.

### Hand-checked fixtures

`examples/fixtures/` (issue step 10): an Accounting transfer student with a
Florida AA and a missed tracking milestone (an impossible plan), a
certificate student with a repeat, a substitution and locks, and the
Psychology + Geology student. The answers were worked by hand from the data
([fixtures/README.md](examples/fixtures/README.md) shows the arithmetic).
`__tests__/fixtures.test.ts` checks audits, credit, GPA, tracking,
eligibility and plans against them.

## Coverage

`__tests__/coverage.test.ts` audits and plans **every program** in the
catalog for an admitted freshman with no prior credit (Fall 2026 start,
through Spring 2030, 18 credits per term). It runs in about 3 s.

| programs | plans | feasible | main blockers when not |
|---|---|---|---|
| majors | 233 | 114 | a tracking deadline the prerequisite chain can't meet for a student with no AP or placement credit (57), no course choosable (30: absent course ids, repeatable topics courses), a course not offered in any planned term (25), credit cap (21), prerequisite chains (19) |
| minors | 167 | 135 | prerequisites outside the minor (restricted to other majors, senior standing at 12 credits per term), absent ids |
| certificates | 83 | 65 | as for minors |

No program fails to audit or plan, and every plan the planner calls
feasible passes `validatePlan`. Infeasible is often the honest answer: many
semester-1 milestones assume AP, dual-enrollment or placement credit that
this student doesn't have. The planner is greedy, not an optimizer, so some
infeasible plans have a feasible ordering it doesn't find.

The audit, eligibility and tracking numbers for one record are in the
sections above (eligibility: 45% of courses with requisites `unknown`;
tracking: 48 of 224 programs `unknown` for the synthetic student).

## Known limitations

- Only the UF cumulative GPA is computed (see [GPA](#gpa)). UF's catalog
  policy pages were unreachable (HTTP 503) when checked on 2026-11-09 and
  2026-11-20, so the upper-division definition is still unconfirmed.
- Requirement flags don't match prose slots ("approved elective"), and a
  course that fills only such a slot is flagged `no`.
- The audit counts a course toward one requirement of the major (gen ed may
  overlap with it); see [audit/README.md](audit/README.md#counting-domains).
  The exception is a required course the page lists twice (`listed_twice`).
  Repeatable topics courses ("take ISS 4932 twice with different topics")
  can't be counted twice.
- For the synthetic student, 45% of the 6,742 courses with requisites
  evaluate `unknown`. The unknown leaves are mostly unparsed text (3,796,
  for example "Degree-seeking students only" on BSC 2010 and 2011),
  instructor permission (1,169), program names from prose (749) and "or
  equivalent" (473). Typing the common prose restrictions is the next win.
- 9 requisite rows name their own course (CHM 2045L's corequisite reads
  "CHM2045L"; "credit cannot be received for both X and Y" was parsed as a
  requirement). The engine treats such a leaf as `unknown`. The scraper
  should drop the exclusion sentences.
- The planner is deterministic and greedy. It chooses one course per slot
  by a fixed ranking (`prefer` overrides it), places each course in the
  earliest term that works, and doesn't backtrack. Plans name requirement
  courses only. Free electives toward a degree's total credits, residency
  and upper-division credit minimums aren't planned, and
  `assumedTermLoad` stands in for them in class standing.
- Requirement-level minimum grades aren't in the program data
  (`grade_minimums_not_checked`). **Prerequisite** minimum grades are: 2,216
  requisite leaves carry `min_grade`.
- Page prose rules (UF residency credits, upper-division minimums, credits
  exclusive to a minor) aren't captured (`program_rules_not_captured`).
- Critical Tracking computes only the UF cumulative GPA. Of 2,625 GPA rules
  on tracking tabs, 1,589 are UF GPA rules and are checked. The other 1,036
  are reported with their thresholds but not checked (`gpa_rule_not_checked`).
- Tracking attempt limits ("within two attempts") and per-course grades
  inside a line aren't checked, and 816 tracking lines are prose notes.
- Summer sessions A/B/C aren't distinguished. The default 15-credit cap and
  the 12-credit assumed load are planner defaults to confirm against UF's
  registration policy.
- Only the 2026-27 catalog is loaded, so a what-if to another catalog year
  throws.
- 29 of 483 programs are `needs_review`: they audit as `unknown`, and their
  plans say they rest on unverified data.

## Readiness

Done on the engine side, against issue #8 steps 3 to 10: the contracts with
examples; one API for audits, eligibility, tracking, plan generation, plan
validation and what-if; AND/OR rules, minimum grades, credit totals,
repeats, transfer credit, permitted overlap and record exceptions, with
unknown wherever the rules or inputs fall short; labelled GPAs; Critical
Tracking with deadline terms; plans that respect prerequisites, deadlines,
caps and locks, report infeasibility and unconfirmed offerings, and keep
locks on regeneration; what-if on a copy; versions on every result;
hand-checked fixtures across three structures; published coverage and
limits.

Not done here, and owned elsewhere or next:

- **Database integration** (step 9, Maria / TEAM-01): records and
  `recordVersion` from Supabase, result caching and invalidation by
  `versions`. `buildCatalog` already takes file text, so a Supabase loader
  only has to produce the same validated `Catalog`.
- **Section scheduling** (step 9): the scheduler should call
  `engine.eligibility` and `validatePlan` instead of recomputing.
- **Recommendation scoring** (issue #11): `scoring.ts` on main should take
  its two flags from `toScoringFlags(engine.requirementFlags(...))` after
  `engine.filterCandidates(...)`.
- **Review**: the fixtures should be reviewed by a second person (an
  advisor, ideally). The issue asks for "manually reviewed".
