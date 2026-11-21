import { CourseHistory } from "./history";
import type { Reason } from "./schemas/common";
import type { Catalog } from "./schemas/catalog";
import { AcademicRecord } from "./schemas/record";
import type { AuditResult, TrackingResult } from "./schemas/results";
import { type ProgramSummary, WhatIfChange, WhatIfResult } from "./schemas/student";
import { generatePlan } from "./planner";
import type { Plan, PlanOptions } from "./schemas/plan";
import { auditStudent, trackStudent } from "./student";
import { resultVersions } from "./versions";

/**
 * What-if: "what if I switched to (or added) this program?" The change is
 * applied to a deep COPY of the record, which gets its own recordVersion
 * ("<version>+what-if"), so a result computed from it can never be mistaken
 * for, or cached as, the saved record's. The saved record and any saved plan
 * are inputs only and are never written (tested by freezing the record).
 *
 * With plan options it also plans the copy and compares that plan with the
 * saved one (or one generated for the record), course by course.
 */
export function whatIf(
  catalog: Catalog,
  record: AcademicRecord,
  change: WhatIfChange,
  plan?: { options: PlanOptions; saved?: Plan },
): WhatIfResult {
  const c = WhatIfChange.parse(change);
  if (c.catalogYear && c.catalogYear !== catalog.catalogYear)
    throw new RangeError(`only the ${catalog.catalogYear} catalog is loaded; a what-if for ${c.catalogYear} needs that catalog's data`);

  const copy = structuredClone(record);
  const before = copy.programs.map((p) => p.programId);
  if (c.programs) copy.programs = structuredClone(c.programs);
  for (const id of c.remove ?? []) copy.programs = copy.programs.filter((p) => p.programId !== id);
  for (const id of c.add ?? []) if (!copy.programs.some((p) => p.programId === id)) copy.programs.push({ programId: id });
  if (c.catalogYear) copy.catalogYear = c.catalogYear;
  copy.recordVersion = `${record.recordVersion}+what-if`;
  const scenarioRecord = AcademicRecord.parse(copy);

  const baseHistory = new CourseHistory(record, catalog);
  const baseAudit = auditStudent(catalog, record, baseHistory);
  const baseTracking = trackStudent(catalog, record, baseHistory);
  const history = new CourseHistory(scenarioRecord, catalog);
  const audit = auditStudent(catalog, scenarioRecord, history);
  const tracking = trackStudent(catalog, scenarioRecord, history);

  const baseline = summaries(baseAudit.programs, baseTracking.programs);
  const scenario = summaries(audit.programs, tracking.programs);
  const after = scenario.map((p) => p.programId);
  const same = (id: string) =>
    JSON.stringify(baseline.find((p) => p.programId === id)) === JSON.stringify(scenario.find((p) => p.programId === id));

  const caveats: Reason[] = plan
    ? []
    : [{ code: "rule_not_modeled", message: "No plan options were given, so plans aren't compared; pass them to get a scenario plan and its difference." }];
  let plans: WhatIfResult["plans"] = null;
  if (plan) {
    // The scenario plans for the copy's programs; locks and terms carry over.
    const shared: PlanOptions = { ...plan.options, programIds: undefined };
    const baselinePlan = plan.saved ?? generatePlan(catalog, record, plan.options);
    const scenarioPlan = generatePlan(catalog, scenarioRecord, { ...shared, planId: `${baselinePlan.planId}-what-if` }, "what_if");
    const ids = (p: Plan) => new Set(p.terms.flatMap((t) => t.courses.flatMap((c) => (c.courseId ? [c.courseId] : []))));
    const lastTerm = (p: Plan) => [...p.terms].reverse().find((t) => t.courses.length)?.term ?? null;
    const [b, s] = [ids(baselinePlan), ids(scenarioPlan)];
    plans = {
      baseline: baselinePlan,
      scenario: scenarioPlan,
      diff: {
        status: { baseline: baselinePlan.status, scenario: scenarioPlan.status },
        plannedCredits: { baseline: baselinePlan.totals.planned, scenario: scenarioPlan.totals.planned },
        lastTerm: { baseline: lastTerm(baselinePlan), scenario: lastTerm(scenarioPlan) },
        coursesAdded: [...s].filter((id) => !b.has(id)).sort(),
        coursesDropped: [...b].filter((id) => !s.has(id)).sort(),
      },
    };
  }
  return WhatIfResult.parse({
    basis: "what_if",
    change: c,
    baseline: { versions: resultVersions(catalog, record), programs: baseline },
    scenario: { versions: resultVersions(catalog, scenarioRecord), audit, tracking, programs: scenario },
    diff: {
      added: after.filter((id) => !before.includes(id)),
      removed: before.filter((id) => !after.includes(id)),
      changed: after.filter((id) => before.includes(id) && !same(id)),
    },
    plans,
    caveats,
  });
}

function summaries(audits: readonly AuditResult[], tracking: readonly TrackingResult[]): ProgramSummary[] {
  return audits.map((a) => {
    const count = (s: string) => a.requirements.filter((r) => r.countsTowardDegree && r.status === s).length;
    return {
      programId: a.programId,
      name: a.programName,
      kind: a.programKind,
      overallStatus: a.overallStatus,
      completedCredits: a.totals.completed.credits,
      inProgressCredits: a.totals.inProgress.credits,
      remainingCredits: a.totals.remaining.credits,
      requirements: {
        satisfied: count("satisfied"),
        in_progress: count("in_progress"),
        not_satisfied: count("not_satisfied"),
        unknown: count("unknown"),
      },
      tracking: tracking.find((t) => t.programId === a.programId)?.status ?? null,
    };
  });
}
