import { termOrder } from "./onboarding"

/* Term helpers for display (the dashboard's term timeline). No academic logic. */

const SEASONS = ["Spring", "Summer", "Fall"] as const

/** Safety cap so a bad profile can't render hundreds of columns (8 years of fall/spring). */
const MAX_TERMS = 16

/**
 * UF term for a calendar day ("YYYY-MM-DD"): Jan-Apr Spring, May-Jul Summer,
 * Aug-Dec Fall. Same rule the mock schedule uses for its weeks.
 */
export function termForDate(iso: string) {
  const [year, month] = iso.split("-").map(Number)
  const season = month <= 4 ? "Spring" : month <= 7 ? "Summer" : "Fall"
  return `${season} ${year}`
}

/**
 * Fall and Spring terms from `first` to `last`, both included, in order.
 * Summer terms appear only when listed in `summers` (a student who took
 * classes then). Returns [] when either term is unreadable or `last` comes
 * before `first`, and at most MAX_TERMS terms.
 */
export function termsBetween(first: string, last: string, summers: string[] = []): string[] {
  const start = termOrder(first)
  const end = termOrder(last)
  if (start == null || end == null || end < start) return []
  const terms: string[] = []
  for (let o = start; o <= end && terms.length < MAX_TERMS; o++) {
    const term = `${SEASONS[o % 3]} ${Math.floor(o / 3)}`
    if (o % 3 !== 1 || summers.includes(term)) terms.push(term)
  }
  return terms
}

/** "Fall 2025" -> "F25", "Summer 2026" -> "Su26". Anything else is returned unchanged. */
export function shortTerm(term: string) {
  const m = term.match(/^(Spring|Summer|Fall) \d{2}(\d{2})$/)
  if (!m) return term
  const prefix = m[1] === "Summer" ? "Su" : m[1][0]
  return `${prefix}${m[2]}`
}
