# Degree audit

`auditProgram(catalog, record, programId)` answers "how far is this student
through this program?" It returns an `AuditResult` (see `../schemas/results.ts`
and the status tables in `../README.md`).

```ts
import { auditProgram } from "@/lib/engines/audit";

const audit = auditProgram(catalog, record, "uglas-gly_umn");
audit.overallStatus;                 // "not_satisfied"
audit.requirements[0].pendingCourses; // GLY 3202C, in progress
```

Auditing several programs for one record? Build one
`new CourseHistory(record, catalog)` and pass it as the last argument. All 483
programs take about 130 ms.

## Files

| file | job |
|---|---|
| `index.ts` | `auditProgram`: walks the groups, applies facts and exceptions, checks the numbers, builds the result |
| `group.ts` | `evaluateGroup`: claims courses for ONE group and decides met / pending / not met / unknown |
| `shape.ts` | how a group is read (its shape), which groups compete for a course, the order they claim in |
| `held.ts` | what the student holds (one entry per course) and the evidence for a counted course |

## How an audit runs

1. **What the student holds** (`held.ts`). Each course is held once: the
   completed passing attempt, else the one in progress (`../history.ts`
   decides; a repeat's credit counts once). Exam credit holds the courses it
   awards. A completed attempt with no grade is held as *ungraded*: it may
   count, so anything it would fill is `unknown`, never met or unmet.
2. **Shape each group** (`shape.ts`). See [Shapes](#shapes).
3. **Claim in spend order.** Groups claim courses one at a time, in
   [spend order](#spend-order). A course claimed by one group is no longer
   free for the other groups in its [counting domain](#counting-domains).
4. **Facts and exceptions.** Waivers, substitutions and allowed overlaps
   from the record (see [Exceptions](#record-facts-and-exceptions)).
5. **Check the numbers.** A group whose rules are met but whose courses fall
   short of the catalog's credits or course count becomes `unknown`, saying
   so (a 3-credit transfer course in a 4-credit slot is an advisor's call).
6. **Combine.** The program's status is the worst status among requirements
   that count toward the degree (`combineRequirementStatuses` in
   `../status.ts`, the same function the schema checks with).

## Shapes

The scraper writes three rule types, but they hide four shapes. Reading a
group by the wrong shape gives confidently wrong answers, so the branch order
in `groupShape` matters:

| shape | when | met when |
|---|---|---|
| `options` | `logic.options`, and not a language ladder (`is_sequence`) | every course of ONE option is held |
| `credits` | `choose_credits`, or credits with no list at all | the held courses from the list reach the credits |
| `count` | `choose_n` with no slots | any N courses of the list are held |
| `slots` | everything else (`required_list`) | each slot has one of its alternatives |

- **Options before credits.** Read as a credit pool, Math BA's "Select one
  sequence" would accept any two courses adding up to 6 credits, including
  pairs UF never printed.
- **`choose_n` without slots is "any N", never N slots.** Slicing a 41-course
  pool to its first two courses asks for two *specific* courses. UF Planner
  shipped that bug.
- **Prose stays visible.** A slot the catalog printed as prose ("PSB or EXP
  electives at the 4000 level") can't be matched to courses. An unfilled
  prose slot is `unknown`, and it is listed in `remainingOptions.openSlots`.
  A credit pool with no list at all is `unknown` for the same reason.
- **A language sequence is one language.** The CLAS language requirement
  (84 programs) is an 8-credit pool over 43 courses with `is_sequence`.
  Read as a plain pool, ARA 1130 + CHI 1130 would meet it. The pool claims
  only the prefix the student holds the most completed credits in.
- **Every result carries a `need`** (`group.ts`): what is still needed, in
  structure (the unfilled slots, the option followed, N more credits from
  the pool). The planner builds its slots from it, so it plans exactly
  what the audit says is missing.

## Counting domains

**A course counts toward one requirement within a domain.** Groups in
different domains may share it.

| domain | groups |
|---|---|
| `program` | the major's and college's own requirements (sections `major`, `college`) |
| `geneed` | gen ed subject areas (composition, humanities, math, sciences, social) |
| `quest` | Quest 1 and 2 (their courses also carry area designations) |
| none | section `options`: alternative routes, shown but never counted, claim nothing |

So PSY 2012 can be both the Psychology core course and a Social Science gen ed
course, but not two rows of the Psychology major. Courses are also never
shared *within* a domain unless the record says so (`allow_overlap`).

**Changed from UF Planner.** UF Planner counted a course toward every group
by default and blocked sharing only inside a catalog `exclusive_set`. Here
sharing is blocked by default inside a domain, and the 155 groups the data
marks with an `exclusive_set` are covered by that rule. Two reasons:

- It keeps the arithmetic honest. With sharing, the 17-credit Geology minor
  could be "done" with 14 credits, because GLY 3202C would fill both the
  required list and the 3000/4000 elective.
- Over-counting tells a student they're done when they aren't. Under-counting
  is the safer error, and an advisor can fix it with an `allow_overlap`
  exception in the record.

**One exception: a required course listed twice.** When a one-course slot's
course already counts toward another requirement of the same program, the
page is stating the same required course twice (Criminology BA lists STA
2023 under "Foundation coursework" and again as the "Statistics course
requirement"). It counts for both, with reason `listed_twice`. Without this
rule, one of the two could never be met: 7 programs, 12 courses.

## Spend order

Specific groups claim first, broad pools last (a `choose_credits` list of 12
or more courses, the same threshold as UF Planner's `BROAD_POOL_MIN_OPTIONS`),
each half in catalog order. A broad elective list takes whatever is left, so it
must not run before the required rows that need particular courses.

Within one group the claim order is:

1. completed before in progress (a group met by completed work never claims
   a current course);
2. courses that help an unmet "at least" rule (`count_rules`);
3. courses no later group in the domain could use, before contested ones;
4. the course itself before an advisor substitute;
5. catalog order.

Rule 3 is why, when two pools share GLY 2100C and the first can finish with
GLY 2010C instead, GLY 2100C is left for the second pool. In a required list,
slots with the fewest alternatives are filled first, for the same reason.
Results are always *listed* in catalog order, whatever order they were
filled in.

The claim is greedy, not an exhaustive search. UF Planner's exact-subset
search for exclusive pools (`creditClaim`) isn't ported yet; the contested
rule gets most of its benefit.

## Record facts and exceptions

| record entry | effect |
|---|---|
| `facts.hasFloridaAA: true` | gen ed groups with `waived_by: aa_or_60_credits` are satisfied (`waived`) |
| `facts.languageProficiency: true` | the CLAS language group is satisfied (`waived`) |
| that fact absent | an unmet group it would waive is `unknown` (`missing_input`), not unmet |
| `waiver` exception | the group is satisfied, claiming no courses |
| `substitution` with `replacesCourseId` | the course stands in for the replaced one wherever it appears |
| `substitution` without it | the course counts as an extra course of that group |
| `allow_overlap` exception | the course may count in every requirement it names |

A substitution only counts a course the student actually holds.

## What a requirement result says

- `appliedCourses` / `pendingCourses`: completed / in-progress courses
  claimed, each with the record entry behind it (`evidenceId`).
- `reasons`: why the status is what it is. Unmet groups name what's still
  needed (`requirements_remaining`) and any course that could have counted but
  went to another requirement (`counted_elsewhere`).
- `remainingOptions`: up to 8 course ids that could still fill it, the total,
  and the prose slots.

A program that `needs_review` claims nothing: crediting a course to a
requirement we can't trust would read as progress. Every requirement is
`unknown`, naming the prose rows that likely caused the review.

## Caveats every audit carries

- `program_rules_not_captured`: residency credits, upper-division minimums,
  credits that can't be shared with another program, independent-study limits.
  The pages state these in prose and the data doesn't encode them.
- `grade_minimums_not_checked`: requirement-level minimum grades aren't in
  the program data, so any passing grade (D included) counts.
- `rule_not_modeled` (gen ed programs): the waiver is "AA or 60 credits";
  only the AA part is checked.

## Coverage today

Synthetic student, third semester, all 483 programs:

| | count |
|---|---|
| programs `not_satisfied` / `unknown` | 452 / 31 |
| counting requirements in published programs | 585 satisfied, 11 in progress, 2,081 not satisfied, 180 unknown |
| why unknown | prose slots or lists 92, language-proficiency fact absent 83, no stated amount 4, numbers short 1 |

## Tests

`../__tests__/audit.test.ts`:

- reproduces both hand-built audit examples: statuses, every applied and
  pending course, remaining options, totals, GPA;
- a finished student satisfies the Geology minor;
- counting: one course per requirement, gen ed overlap, allowed overlap,
  contested courses left for later groups;
- facts and every exception kind;
- the whole catalog audits to valid, deterministic results.

Mutation checks were run: collapsing the domains, reversing spend order and
ignoring contested courses each fail tests.
