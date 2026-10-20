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
  - Available now: catalog data (title, credits, level, prerequisites, description).
  - Available from the academic engine (TEAM-02, Shaun): major-to-subject
    mapping and requirement-slot / eligibility data. Q3 and Q5 depend on these.
  - Not available yet: section times and formats (no tracked owner yet; see
    "Future questions") and professor ratings (a later feature).
- Do NOT ask for things we already know: major, class year, completed courses.
  Those come from onboarding / transcript import (the onboarding and storage teams).
- **Hard constraint** = never violated, used to filter candidates BEFORE ranking.
  **Preference** = nudges the score, never removes a course.
- **Every question is optional.** A student who skips the whole survey still gets
  useful baseline results (issue #11 cold-start requirement). The survey step has
  a "Skip for now" button and can be retaken later from settings.
- Survey answers are student data: stored through the shared persistence layer and
  deleted with the account.

## Questions

| # | Question (what the student sees) | Answer type | Options | Kind | Used for | Data needed |
|---|---|---|---|---|---|---|
| Q1 | Which topics are you most interested in? | Pick any (no cap) | The 22 interest IDs, shown in 6 groups | Preference | Interest-match score (see "Scoring notes") | Course tags |
| Q2 | Any topics you'd rather not see? | Pick any (no cap) | The 22 interest IDs | Hard constraint | Removes courses whose tags are only in these interests. Warn the student if this leaves few recommendations. An interest can't be picked in both Q1 and Q2. | Course tags (description-based; see "Scoring notes") |
| Q3 | Do you want suggestions mostly inside your major, or outside it? | Pick one | `inside_major`, `mix`, `outside_major` | Preference | Boosts or lowers courses by whether they fall in the student's major subjects. **Hidden when major is undeclared.** | Major (onboarding) + major-to-subject map (TEAM-02) |
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

Q2 removes courses, so it needs accurate tags. With subject-level tags only,
excluding `math_physical_sciences` would remove every MAC course. Q2 should only
filter on tags reviewed from course descriptions (provenance
`description_reviewed`, see the interest list). Until those exist, treat Q2 as a
strong penalty instead of a filter.

## Future questions (not in the live survey yet)

Each is held back because the data to act on it doesn't exist. Asking now would
promise a filter or boost the system can't apply.

### F1: Are there class times you can't do? (was Q6)

Answer: list of time ranges, each `{days, start, end}` (days Mon to Fri). Kind:
hard constraint. Removes a course if every one of its sections overlaps a blocked
range; a partial overlap counts as a conflict.

Needs section times. The original section-data issue (#5) was closed and no open
issue tracks section data yet (only #14, the scraping pipeline). This may fit
better as a schedule-builder setting than an interest question.

### F2: How do you want to attend class? (was Q7)

Options: `in_person`, `online`, `hybrid` (pick any). Kind: hard constraint.
Filters out courses with no section in an allowed format. Needs section formats.

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

Question IDs and option values are stable snake_case, like the interest IDs.
Display text can be reworded freely.

**Frontend notes:**
- The survey has its own types and validation, separate from
  `OnboardingProfile` (which only holds strings). Suggested home:
  `lib/survey.ts` with the schema and a pure `validateSurvey()`, so the server
  can reuse it, same as `validateProfile()`.
- Needs checkbox/chip groups and radio groups; only `NativeSelect` exists today.
  22 chips is a lot for the onboarding card, so give the survey its own step.
- `validateSurvey()` rejects the same interest in both Q1 and Q2.

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

## Changes from v0

- Q6 (class times) and Q7 (format) moved to Future questions: they were hard
  constraints the system couldn't enforce, and section data has no tracked owner.
- Q1 scoring changed from 1 / (number picked) to a normalized 0-1 overlap score.
- All questions marked optional; skipping the survey is supported.
- Q3 hidden for undeclared students; Q8 (now Q6) defaults to `exploring` for them.
- Q2 limited to description-reviewed tags; Q1/Q2 overlap rejected.
- Data dependencies for Q3 and Q5 on TEAM-02 listed explicitly.
- Schema options use `{ value, label }` to match the app's `Option` type.
- Storage format changed to `{question_id, status, value}` plus survey and
  interest-list versions; dropped the unused `order` field.
