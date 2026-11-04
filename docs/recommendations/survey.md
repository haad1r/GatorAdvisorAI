# GatorAdvisor interest survey (DRAFT v1)

**Author:** Alan (@fanggs)
**Issue:** #11, step 1: "a short survey with interests and preferences;
distinguish hard constraints."
**Survey version:** `survey_v1` · **Uses interest list:** `interests_v1` (see [interest-list.md](interest-list.md))

## Design rules

- Every question must change a result. If an answer is never used in scoring or
  filtering, cut the question.
- Only ask a question if the system can act on the answer. That requires data
  the system actually has.
  - Available as source data: catalog fields (title, credits, level,
    prerequisites, description) and Schedule of Courses sections, including
    times and delivery formats, in the UF data pipeline (#16).
  - Available only after the academic-engine handoff (TEAM-02, Shaun):
    validated eligibility, requirement-slot contribution, and plan-add checks.
    Q3 and Q5 depend on requirement-slot contribution.
  - Not yet available as a recommendation-service contract: confirmed,
    term-specific section availability. Professor ratings are a later feature.
- Do NOT ask for things we already know: major, class year, completed courses.
  Those come from onboarding / transcript import (the onboarding and storage teams).
- **Hard constraint** = never violated, used to filter candidates BEFORE ranking.
  Academic eligibility, completed-course and explicit-dismissal rules come from
  the academic engine and feedback service, not from this survey. Unknown
  eligibility is never advertised as eligible. **Preference** = nudges the
  score, never removes a course. All six survey answers are preferences.
- **Every question is optional.** A student who skips the whole survey still gets
  useful baseline results (issue #11 cold-start requirement). The survey step has
  a "Skip for now" button and can be retaken later from settings.
- Survey answers are student data: stored through the shared persistence layer and
  deleted with the account.

## Questions

| # | Question (what the student sees) | Answer type | Options | Kind | Used for | Data needed |
|---|---|---|---|---|---|---|
| Q1 | Which topics are you most interested in? | Pick any (no cap) | The 22 interest IDs, shown in 6 groups | Preference | Interest-match score (see "Scoring notes") | Course tags |
| Q2 | Which topics interest you less? | Pick any (no cap) | The 22 interest IDs | Preference | Lowers the score for matching description-reviewed tags; never filters or changes eligibility. An interest can't be picked in both Q1 and Q2. | Description-reviewed course tags |
| Q3 | Do you want suggestions mostly inside your major, or outside it? | Pick one | `inside_major`, `mix`, `outside_major` | Preference | Boosts or lowers courses using verified requirement-slot contribution for the student's program. **Hidden when major is undeclared.** | Major (onboarding) + requirement-slot result (TEAM-02) |
| Q4 | What course level do you want right now? | Pick one | `intro` (1000-2000), `advanced` (3000-4000), `no_preference` | Preference | Boosts courses by level (from the course number) | Catalog course numbers |
| Q5 | Should we favor courses that also count toward Gen Ed or degree requirements? | Pick one | `yes`, `no_preference` | Preference | Weights the requirement-progress score in discovery results | Requirement-slot data (TEAM-02) |
| Q6 | Are you still exploring? | Yes / No | `exploring`, `settled` | Preference | If `exploring`, ranking spreads across more interests (more diversity). **Starts at `exploring` when major is undeclared.** | None |

6 questions in the live survey. The section-based questions (class times and
format) and workload are held back until their data exists (see below).

## Scoring notes

### Q1 interest score

```
interest_score = |course_tags ∩ picked_interests| / |course_tags|
```

The score is always between 0 and 1. A student who picks many interests is not
penalized. (Weighting each pick by 1 / number picked would shrink the interest
component for broad students until requirement progress decides everything.)
If the student skipped Q1, the interest component is skipped, not scored as 0.

### Q2 and tag quality

Q2 is a preference, even when description-reviewed tags exist. A selected
interest lowers a course's interest component only when that course has a
matching `description_reviewed` tag (see the interest list). Subject-level tags
are too broad for a negative signal. If no reviewed tags are available for a
course, omit the Q2 component rather than assuming it matches or promising its
absence. The scoring reason must identify the tag and its provenance whenever
Q2 changes a score. Academic eligibility and explicit dismissals remain hard
filters before ranking.

## Future questions (not in the live survey yet)

The SOC data pipeline supplies section times and delivery modes, but the
recommendation service still needs a validated, term-specific availability
contract and integration smoke check from the academic engine before it can
enforce them. Workload data is also unavailable. Asking these questions now
would promise behavior the service cannot guarantee.

### F1: Are there class times you can't do? (was Q6)

Answer: list of time ranges, each `{days, start, end}` (days Mon to Fri). Kind:
hard constraint. Removes a course if every one of its sections overlaps a blocked
range; a partial overlap counts as a conflict.

The source section times are in `data/soc/sections/`; the question waits for
TEAM-02 to provide confirmed target-term availability and scheduling semantics.
This may fit better as a schedule-builder setting than an interest question.

### F2: How do you want to attend class? (was Q7)

Options: `in_person`, `online`, `hybrid` (pick any). Kind: hard constraint.
Filters out courses with no confirmed section in an allowed format. Source
formats are in `data/soc/sections/`; enforcement waits for the same TEAM-02
target-term availability contract as F1.

### F3: How heavy a workload do you want next semester? (was Q9)

Options: `light`, `medium`, `heavy`, `no_preference`. Kind: preference. Boosts
courses whose workload matches the answer.

The UF catalog has no workload data, so we would need a workload value for each
course. Possible sources:

1. **Syllabus estimates:** hours per week, exams, and projects taken from
   syllabi. Most accurate, but syllabi must be collected and processed.
2. **Student ratings collected by GatorAdvisor:** students rate how heavy a
   course is, averaged per course. The project doesn't scrape RateMyProfessors
   (the README only links out to it), so these would be GatorAdvisor's own.
   Needs enough reviews per course.
3. **Feedback over time:** "too heavy" signals once real users exist.
4. **Catalog proxies:** credits, level, lab or not. Available now, but only
   rough guesses.

Until a source exists, the baseline has no workload component (weight 0).
Missing data is skipped, never treated as a bad score.

## Deliberately left out (and why)

- **Career goal:** needs a second vocabulary mapped to courses. Maybe v1.
- **Professor preference:** no usable ratings data, since the project doesn't
  scrape RateMyProfessors and GatorAdvisor's own ratings don't exist yet.
- **Major / year:** already known from onboarding.

## Question schema (for the frontend)

The frontend builds the form from structured data, not from prose. Options use
`{ value, label }` to match the existing `Option` type in `lib/onboarding.ts`.
Example for Q4:

```json
{
  "id": "course_level",
  "text": "What course level do you want right now?",
  "type": "single_choice",
  "required": false,
  "constraint_kind": "preference",
  "options": [
    { "value": "intro", "label": "Intro (1000-2000 level)" },
    { "value": "advanced", "label": "Advanced (3000-4000 level)" },
    { "value": "no_preference", "label": "No preference" }
  ]
}
```

Conditional questions carry a `show_if` / `default_if` rule, e.g. Q3:

```json
{ "id": "major_scope", "show_if": { "major_not": "undeclared" } }
```

The stable question IDs are `interests` (Q1), `lower_interest_topics` (Q2),
`major_scope` (Q3), `course_level` (Q4), `requirement_progress` (Q5), and
`exploration_mode` (Q6). Q1 and Q2 use `multi_choice` with the 22 options from
`interests_v1`; Q3-Q6 use `single_choice` with the values in the table above.
Every question has `required: false` and `constraint_kind: "preference"`.
Question IDs and option values are stable snake_case, like the interest IDs.
Display text can be reworded freely.

**Frontend notes:**
- The survey has its own types and validation, separate from
  `OnboardingProfile` (which only holds strings). Suggested home:
  `lib/survey.ts` with the schema and a pure `validateSurvey()`, so the server
  can reuse it, same as `validateProfile()`.
- Needs checkbox/chip groups and radio groups; only `NativeSelect` exists today.
  22 chips is a lot for the onboarding card, so give the survey its own step.
- `validateSurvey()` rejects the same interest in both Q1 and Q2 and unknown
  IDs or option values for the recorded survey and interest-list versions.

## What the storage team would need

Per student, one survey response:

```json
{
  "survey_version": "survey_v1",
  "interest_list_version": "interests_v1",
  "submitted_at": "2026-10-17T15:00:00Z",
  "answers": [
    { "question_id": "interests", "status": "answered", "value": ["ai_data", "life_sciences"] },
    { "question_id": "course_level", "status": "answered", "value": "advanced" },
    { "question_id": "major_scope", "status": "skipped", "value": null }
  ]
}
```

- `value` depends on the question type: a list for pick-any, a single value for
  pick-one and yes/no (and a list of `{days, start, end}` if F1 ships).
- `status` keeps "skipped" separate from an explicit `no_preference`.
- When answers change, store the new response with its own timestamp so rankings
  can be regenerated. Keep both version fields so old answers can be read after
  the survey or the interest list changes.
- Maria owns the persistence interface and account-deletion behavior. Alan and
  Sid provide versioned answer and scoring examples; the frontend must not
  create an independent survey store. Recommendation impressions and feedback
  are separate events, with request/scoring versions and idempotency as required
  by issue #11. No event is written from this design document alone.

## Changes from v0

- Q6 (class times) and Q7 (format) moved to Future questions: they were hard
  constraints the system couldn't enforce, and section data has no tracked owner.
- Q1 scoring changed from 1 / (number picked) to a normalized 0-1 overlap score.
- All questions marked optional; skipping the survey is supported.
- Q3 hidden for undeclared students; Q8 (now Q6) defaults to `exploring` for them.
- Q2 is explicitly a preference based only on description-reviewed tags; it
  never acts as a hard filter. Q1/Q2 overlap is rejected.
- Data dependencies for Q3 and Q5 on TEAM-02 listed explicitly.
- Schema options use `{ value, label }` to match the app's `Option` type.
- Storage format changed to `{question_id, status, value}` plus survey and
  interest-list versions; dropped the unused `order` field.
