# Hand-checked fixtures (issue #8, step 10)

Three synthetic students across three program structures. Every value in
`*.expected.json` was worked by hand from the catalog data (`data/`), not
copied from engine output. `__tests__/fixtures.test.ts` checks the engine
against them. When a hand check and the engine disagreed, the data was
re-read to settle it. Twice the hand check was wrong (both are noted
below), and twice it caught an engine bug (the language sequence, the
tracking chain).

| fixture | program structure | covers |
|---|---|---|
| 001 (`../record.json`) | Psychology BS01 (required lists, choosers, gen ed, Critical Tracking) + Geology minor | a repeat (D then B), a withdrawal, dual enrollment, AP credit, courses in progress, gen ed / major overlap |
| 002 | Accounting BSAc (plan-derived spine, gen ed waived by an AA, options groups) | transfer credit at the sending school's hours, a Florida AA waiver, elective credit, a missed tracking milestone, an impossible plan, a credit cap too small |
| 003 | Biosecurity and Biological Invasions certificate (required list + elective pool) | a failed course retaken now, an advisor substitution, locks that survive regeneration, a locked course the schedule doesn't offer, a cap too small for the locked load |

## 002: Accounting transfer student

Fall 2024 to Spring 2026 at Santa Fe College (AA, 60 credits), at UF since
Fall 2026. `firstTerm` is the first college term, so Fall 2026 is
semester 5.

**Audit (`ugact-act_bsac`).** The requirements are a 93-credit list derived
from the model plan (27 slots: 22 courses, one CGS 2531 / ISM 3013 choice,
5 prose "Elective" rows), two 3-credit option groups (ACG 4632, or ACG 5637
and 5647; TAX 4001, or TAX 5025 and 5027) and six gen ed areas, each
`waived_by: aa_or_60_credits`.

- `facts.hasFloridaAA: true` waives all six gen ed areas: satisfied, claiming
  nothing (reason `waived`). So ENC 1101 counts nowhere: `unapplied`.
- Transfer courses held: ECO 2023, MAC 2233, ECO 2013, ACG 2021, ACG 2071,
  STA 2023, 3 credits each at Santa Fe = **18 completed**, listed in slot order.
- In progress at UF: CGS 2531 (3), ACG 3101, FIN 3403, MAN 3025, QMB 3250
  (4 each) = **19 in progress**.
- Still needed in the list: GEB 2216, MAC 2234, GEB 3218, ACG 3401, ACG 4111,
  MAR 3023, QMB 3302, ACG 4341, BUL 4310, GEB 3373, MAN 4504 = **11** courses,
  plus the 5 prose rows (unknown). AND of not_met and unknown is
  **not_satisfied**.
- Required: 93 + 3 + 3 + 21 (gen ed) = **120**. Remaining: list 93 - 18 - 19
  = 56, plus the two option groups 3 + 3, plus gen ed 0 (waived) = **62**.
- Credit earned: 21 course credits + 39 AA elective credits = **60**. In
  progress 19. No graded UF course yet: UF GPA **null**.

**Tracking.** 38 milestone rows. Semesters 1 to 3 count rows (2, 4 and 6 of the
8 tracking courses): 6 held, **met**. GPA rows due without a UF GPA:
**unknown**. Semester 4 "all 8": 6 held + CGS 2531 pending, MAC 2234 missing
→ **not_met** (missed). Semester 5: ACG 3101 in progress → **pending**; "2 of
the 8 business core" with three in progress → **pending**; UF GPA due this
term with courses in progress → **pending**. Program status **not_met**;
next deadline semester 5 = Fall 2026, rows 16-19.

**Eligibility, Spring 2027.** MAC 2234 (MAC 2233, min C: the C meets it)
**eligible**. ACG 4111 (ACG 3101 min C and FIN 3403, both in progress)
**eligible_pending**. TAX 4001 (ACG 4111 and ACG 4341 not taken) **not
eligible**. GEB 3373 (MAN 3025 pending, MAR 3023 missing) **not eligible**. ACG
3101 (a placement score the record can't show) **unknown**.

**Plans.** Remaining work = 47 course credits + 5 prose rows at 3 assumed =
**62 credits**. The prerequisite chains fix the earliest terms: MAC 2234 and
ACG 3401 Spring 2027; ACG 4341 (needs ACG 3101, ACG 3401, QMB 3250, MAC 2234) and
GEB 3373 (needs MAR 3023) Fall 2027; ACG 4632, TAX 4001 (need ACG 4111 + 4341)
and MAN 4504 (needs GEB 3373, BUL 4310 and the core) Spring 2028.

- Through Fall 2028 at 18 credits (4 terms, 72 ≥ 62): infeasible, with exactly
  **one** blocker, the missed semester-4 milestone. No plan can fix it.
- Through Spring 2028 at 18 (3 terms, 54 < 62): also **credit_cap**. My first
  hand count said 4 terms; Spring 2027 to Spring 2028 is 3, and the engine was
  right.

## 003: certificate student

Fall 2025 start, Fall 2026 now. BSC 2010 + lab (A, A), BSC 2011 (E) and
lab (B), ENY 3005 (B); retaking BSC 2011 and taking ALS 4161 now.
Substitution `s01`: ENY 3005 counts as the approved elective.

**Audit (`ugagl-agl_uct14`).** Required ALS 4161 / ALS 4162 / ENY 4905 (7
credits): ALS 4161 pending, two missing → **not_satisfied**, remaining 2
courses. Approved electives (2 credits from a list without ENY 3005): ENY
3005 by substitution, 3 credits → **satisfied** (`substitution_applied`).
Totals: required 7 + 2 = **9**, completed **3**, in progress **3**, remaining
7 - 0 - 3 = **4**. Unapplied: BSC 2010, BSC 2010L, BSC 2011L (the failed BSC
2011 earns nothing).

**Credit and GPA.** Earned 3 + 1 + 1 + 3 = **8**; in progress 3 + 3 = **6**.
UF GPA: A·3 + A·1 + E·3 + B·1 + B·3 = 12 + 4 + 0 + 3 + 9 = **28 points / 11
hours = 2.55**. The E stays in the GPA, as UF counts every attempt.

**Eligibility, Spring 2027.** ALS 4162 (BSC 2010 or lab; BSC 2011 or lab or
equivalent: BSC 2011L's B meets it) **eligible**, offered. ENY 4905 (ENY 3005
and "the basic course in selected specialization", unparsed) **unknown**.
BSC 2011 **unknown**: I expected eligible, but its prerequisite also says
"Degree-seeking students only", which isn't parsed. ALS 4161 is eligible,
but **not_scheduled** in Spring 2027 (fall only).

**Plans.**
- Through Spring 2027, ENY 4905 locked: ALS 4162 + ENY 4905 = **4 credits**,
  **feasible**.
- Regenerated with IPM 4114 also locked to Spring 2027: IPM 4114 runs only in
  summers, so **locked_conflict**. Both locks stay where they were put.
- A 3-credit cap: the locked 1-credit ENY 4905 leaves 2, and ALS 4162 needs 3
  → **credit_cap**, ALS 4162 unplaced.

## 001

The audit, eligibility and tracking values are the ones the examples in
`..` already check by hand (see `../../README.md`, Examples). Added here:
credit 31 earned / 12 in progress, UF GPA 2.96 (71 / 24), PSY 2012 and BSC
2010 shared between the major and gen ed, a feasible plan through Spring 2029,
and an infeasible one-term plan (about 60 credits in one 15-credit term).
BSC 2010 is **unknown** for a repeat, because of the same "Degree-seeking
students only" text.
