/* Display formatting shared by screens. Dates use America/New_York so server and browser agree. */

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/New_York" })

/** "Oct 4, 2026" from an ISO timestamp. */
export function formatDate(iso: string) {
  return DATE.format(new Date(iso))
}

/** "COP3502" -> "COP 3502", "PHY2048L" -> "PHY 2048L". Leaves anything else alone. */
export function formatCourseCode(code: string) {
  return code.replace(/^([A-Z]{3})(\d{4}[A-Z]?)$/, "$1 $2")
}

/** "6 of 14 credits", "2 of 7 courses", or "" when the requirement isn't counted that way. */
export function formatProgress(
  needed: { credits: number | null; courses: number | null },
  earned: { credits: number; courses: number }
) {
  if (needed.credits != null) return `${earned.credits} of ${needed.credits} credits`
  if (needed.courses != null) return `${earned.courses} of ${needed.courses} ${needed.courses === 1 ? "course" : "courses"}`
  return ""
}
