import { auditProgram } from "./audit";
import { type EligibilityOptions, evaluateEligibility } from "./eligibility";
import { filterCandidates, requirementFlags, toScoringFlags } from "./flags";
import { CourseHistory } from "./history";
import { type Term, nextRegularTerm, toCourseId } from "./schemas/common";
import type { Catalog } from "./schemas/catalog";
import { AcademicRecord } from "./schemas/record";
import type { WhatIfChange } from "./schemas/student";
import { auditStudent, trackStudent } from "./student";
import { evaluateTracking } from "./tracking";
import { generatePlan, regenerationOptions } from "./planner";
import type { Plan, PlanDraft, PlanOptions } from "./schemas/plan";
import { draftOf, validatePlan } from "./validate";
import { whatIf } from "./whatif";

/**
 * The academic engine's public API (issue #8, step 4). One implementation
 * of the academic rules, shared by every consumer: the frontend renders
 * these results, the advisor explains them, recommendation scoring and the
 * section scheduler call them. None of them decides eligibility or
 * requirement progress on its own.
 *
 *   const engine = createAcademicEngine(loadCatalog("data"));
 *   engine.audit(record)                       StudentAudit
 *   engine.eligibility(record, "COP 3503C")    EligibilityResult (next fall/spring)
 *   engine.requirementFlags(record, codes)     RequirementFlags
 *   engine.filterCandidates(record, codes)     CandidateFilter
 *   engine.tracking(record)                    StudentTracking
 *   engine.whatIf(record, { add: [...] })      WhatIfResult (record untouched)
 *   engine.generatePlan(record, options)       Plan
 *   engine.regeneratePlan(record, plan)        Plan, with the old plan's locks kept
 *   engine.validatePlan(record, planOrDraft)   PlanCheck
 *
 * Plain functions: no UI, no clock, no network, no database writes. Every
 * call validates the record at the boundary (a malformed record throws a
 * ZodError naming the bad field) and every result is schema-checked before
 * it is returned. Course codes may be given in any spelling; results use
 * ids ("cop3503c") and display codes ("COP 3503C").
 */
export function createAcademicEngine(catalog: Catalog) {
  const read = (record: unknown) => {
    const r = AcademicRecord.parse(record);
    return { r, history: new CourseHistory(r, catalog) };
  };
  return {
    catalog,
    audit(record: unknown) {
      const { r, history } = read(record);
      return auditStudent(catalog, r, history);
    },
    auditProgram(record: unknown, programId: string) {
      const { r, history } = read(record);
      return auditProgram(catalog, r, programId, history);
    },
    eligibility(record: unknown, course: string, term?: Term, options?: EligibilityOptions) {
      const { r, history } = read(record);
      const concurrent = options?.concurrent?.map(toCourseId);
      return evaluateEligibility(catalog, r, toCourseId(course), term ?? nextRegularTerm(r.currentTerm), { concurrent }, history);
    },
    requirementFlags(record: unknown, courses: readonly string[]) {
      const { r, history } = read(record);
      return requirementFlags(catalog, r, courses, history);
    },
    filterCandidates(record: unknown, courses: readonly string[], term?: Term) {
      const { r, history } = read(record);
      return filterCandidates(catalog, r, courses, term ?? nextRegularTerm(r.currentTerm), history);
    },
    tracking(record: unknown) {
      const { r, history } = read(record);
      return trackStudent(catalog, r, history);
    },
    trackingForProgram(record: unknown, programId: string) {
      const { r, history } = read(record);
      return evaluateTracking(catalog, r, programId, history);
    },
    whatIf(record: unknown, change: WhatIfChange, plan?: { options: PlanOptions; saved?: Plan }) {
      return whatIf(catalog, read(record).r, change, plan);
    },
    generatePlan(record: unknown, options: PlanOptions) {
      return generatePlan(catalog, read(record).r, options);
    },
    /** Regenerate keeping every lock (and any option changes). */
    regeneratePlan(record: unknown, plan: Plan, changes: Partial<PlanOptions> = {}) {
      return generatePlan(catalog, read(record).r, regenerationOptions(plan, changes));
    },
    validatePlan(record: unknown, plan: Plan | PlanDraft) {
      return validatePlan(catalog, read(record).r, "slots" in plan ? draftOf(plan) : plan);
    },
  };
}
export type AcademicEngine = ReturnType<typeof createAcademicEngine>;

// The catalog loader (./catalog/load) reads files, so it isn't re-exported:
// import it only where Node runs.
export { toScoringFlags, requirementFlags, filterCandidates };
export { auditStudent, trackStudent, whatIf, auditProgram, evaluateEligibility, evaluateTracking, CourseHistory };
export { generatePlan, regenerationOptions, validatePlan, draftOf };
export { offeringOf } from "./offering";
export { parseCourseId, toCourseId, toDisplayCode } from "./schemas/common";
