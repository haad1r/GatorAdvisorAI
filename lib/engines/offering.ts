import { type Term, compareTerms, termCode, termOfCode } from "./schemas/common";
import type { Catalog } from "./schemas/catalog";
import type { Offering } from "./schemas/results";

/**
 * Is a course offered in a term? Answered from the Schedule of Courses terms
 * the scraper read (catalog.schedule), and only from them:
 *
 * - A published term is a fact: the course is in it (confirmed) or, when the
 *   whole schedule was read, isn't (not_scheduled). A partly read term can
 *   only confirm.
 * - A future term is an inference from the same season in past terms
 *   (historical / not_seen). It is labelled as such and never "confirmed":
 *   the issue requires unconfirmed future offerings to be reported as such.
 *
 * Offering never changes eligibility; consumers decide what to do with it
 * (the candidate filter excludes only not_scheduled).
 */
export function offeringOf(catalog: Catalog, courseId: string, term: Term): Offering {
  const { terms, offeredTerms, source } = catalog.schedule;
  const code = termCode(term);
  const offered = new Set(offeredTerms[courseId] ?? []);
  const sameSeason = terms.filter((t) => t.term.season === term.season && compareTerms(t.term, term) !== 0);
  const seenInSeason = sameSeason
    .filter((t) => offered.has(t.code))
    .map((t) => termOfCode(t.code))
    .sort((a, b) => compareTerms(b, a));
  const name = `${term.season[0].toUpperCase()}${term.season.slice(1)} ${term.year}`;
  const seen = seenInSeason.length
    ? `last offered ${seenInSeason[0].season} ${seenInSeason[0].year}, ${seenInSeason.length} of ${sameSeason.length} ${term.season} terms read`
    : `in none of the ${sameSeason.length} ${term.season} terms read`;
  const out = (status: Offering["status"], message: string): Offering => ({ status, term, seenInSeason, message, source });

  const published = terms.find((t) => t.code === code);
  if (published) {
    // An open term can still gain sections: say which snapshot this is.
    const asOf = published.closed ? "" : ` as read on ${published.fetchedAt.slice(0, 10)}`;
    if (offered.has(code)) return out("confirmed", `In the published ${name} Schedule of Courses.`);
    if (published.complete) return out("not_scheduled", `Not in the published ${name} Schedule of Courses${asOf}.`);
    return out("unknown", `Not found in the ${name} schedule, but that term was only partly read (${published.problems ?? "incomplete"}).`);
  }
  if (sameSeason.length === 0) return out("unknown", `The ${name} schedule isn't published and no ${term.season} term was read to compare with.`);
  if (seenInSeason.length)
    return out("historical", `The ${name} schedule isn't published yet; offered in past ${term.season} terms (${seen}). Not confirmed.`);
  return out("not_seen", `The ${name} schedule isn't published yet, and the course was ${seen}.`);
}
