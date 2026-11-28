import type { FieldErrors } from "@/lib/forms"
/**
 * Onboarding profile collected after sign-up.
 *
 * TEMPORARY OPTION LISTS: majors, catalog years and terms below are
 * presentation-only placeholders. Replace them with the approved fixture
 * schema / API once TEAM-02 finalizes it — don't add more here.
 */
export type OnboardingProfile = {
  preferredName: string
  classStanding: string
  major: string
  catalogYear: string
  /** First term at UF ("Fall 2025"). Anchors Critical Tracking semesters. */
  entryTerm: string
  expectedGraduation: string
}
export const emptyProfile: OnboardingProfile = {
  preferredName: "",
  classStanding: "",
  major: "",
  catalogYear: "",
  entryTerm: "",
  expectedGraduation: "",
}
export type Option = { value: string; label: string }
export const CLASS_STANDING_OPTIONS: Option[] = [
  { value: "freshman", label: "Freshman" },
  { value: "sophomore", label: "Sophomore" },
  { value: "junior", label: "Junior" },
  { value: "senior", label: "Senior" },
]
export const PLACEHOLDER_MAJOR_OPTIONS: Option[] = [
  { value: "computer-engineering", label: "Computer Engineering" },
  { value: "computer-science", label: "Computer Science" },
  { value: "electrical-engineering", label: "Electrical Engineering" },
  { value: "undeclared", label: "Undeclared / exploring" },
]
export const PLACEHOLDER_CATALOG_YEARS: Option[] = [
  "2023-2024",
  "2024-2025",
  "2025-2026",
  "2026-2027",
].map((y) => ({ value: y, label: y }))
/** Newest first: most students pick a recent term. */
export const PLACEHOLDER_ENTRY_TERMS: Option[] = [
  "Spring 2027",
  "Fall 2026",
  "Summer 2026",
  "Spring 2026",
  "Fall 2025",
  "Summer 2025",
  "Spring 2025",
  "Fall 2024",
  "Summer 2024",
  "Spring 2024",
  "Fall 2023",
  "Summer 2023",
  "Spring 2023",
  "Fall 2022",
].map((t) => ({ value: t, label: t }))
export const PLACEHOLDER_GRAD_TERMS: Option[] = [
  "Spring 2027",
  "Fall 2027",
  "Spring 2028",
  "Fall 2028",
  "Spring 2029",
  "Fall 2029",
  "Spring 2030",
].map((t) => ({ value: t, label: t }))
const GRAD_ORDER_ERROR = "Graduation has to come after your first term."

/**
 * Field errors once `field` has been edited: its own error goes, and so does
 * the graduation-order error when the first term changes, since that can fix it.
 */
export function errorsAfterChange(errors: FieldErrors | undefined, field: keyof OnboardingProfile) {
  if (!errors) return errors
  const next: FieldErrors = { ...errors, [field]: undefined }
  if (field === "entryTerm" && errors.expectedGraduation?.[0] === GRAD_ORDER_ERROR) next.expectedGraduation = undefined
  return next
}

/** Human-readable labels, used by FormErrorSummary links and the review step. */
export const PROFILE_LABELS: Record<keyof OnboardingProfile, string> = {
  preferredName: "Preferred name",
  classStanding: "Class standing",
  major: "Major",
  catalogYear: "Catalog year",
  entryTerm: "First term at UF",
  expectedGraduation: "Expected graduation",
}
export const ONBOARDING_STEPS = [
  {
    id: "about",
    title: "About you",
    fields: ["preferredName", "classStanding"],
  },
  {
    id: "program",
    title: "Your program",
    fields: ["major", "catalogYear", "entryTerm", "expectedGraduation"],
  },
  { id: "review", title: "Review", fields: [] },
  /*
   * After the profile is saved: the survey is stored against the profile, and
   * Q3/Q6 depend on the major. Optional; its schema lives in lib/survey.ts.
   */
  { id: "interests", title: "Interests", fields: [] },
] as const satisfies ReadonlyArray<{
  id: string
  title: string
  fields: ReadonlyArray<keyof OnboardingProfile>
}>
const NAME_MAX = 50
/** "Fall 2025" -> a number that sorts terms in time order, or null. */
export function termOrder(term: string): number | null {
  const m = term.match(/^(Spring|Summer|Fall) (\d{4})$/)
  if (!m) return null
  return Number(m[2]) * 3 + ["Spring", "Summer", "Fall"].indexOf(m[1])
}

function oneOf(options: Option[], value: string) {
  return options.some((o) => o.value === value)
}
/**
 * Validate the given fields of a profile. Pure function so it can be
 * reused by a server action later (never trust client-side checks alone).
 */
export function validateProfile(
  profile: OnboardingProfile,
  fields: ReadonlyArray<keyof OnboardingProfile> = Object.keys(
    profile
  ) as (keyof OnboardingProfile)[]
): FieldErrors {
  const errors: FieldErrors = {}
  const add = (k: keyof OnboardingProfile, msg: string) => {
    ;(errors[k] ??= []).push(msg)
  }
  for (const field of fields) {
    const value = profile[field].trim()
    switch (field) {
      case "preferredName":
        if (!value) add(field, "Enter the name you'd like us to use.")
        else if (value.length > NAME_MAX)
          add(field, `Keep it under ${NAME_MAX} characters.`)
        break
      case "classStanding":
        if (!oneOf(CLASS_STANDING_OPTIONS, value))
          add(field, "Choose your class standing.")
        break
      case "major":
        if (!oneOf(PLACEHOLDER_MAJOR_OPTIONS, value))
          add(field, "Choose your major, or pick “Undeclared”.")
        break
      case "catalogYear":
        if (!oneOf(PLACEHOLDER_CATALOG_YEARS, value))
          add(field, "Choose the catalog year you entered under.")
        break
      case "entryTerm":
        if (!oneOf(PLACEHOLDER_ENTRY_TERMS, value))
          add(field, "Choose your first term at UF.")
        break
      case "expectedGraduation": {
        if (!oneOf(PLACEHOLDER_GRAD_TERMS, value)) {
          add(field, "Choose when you expect to graduate.")
          break
        }
        const start = termOrder(profile.entryTerm.trim())
        const end = termOrder(value)
        if (fields.includes("entryTerm") && start !== null && end !== null && end <= start)
          add(field, GRAD_ORDER_ERROR)
        break
      }
    }
  }
  return errors
}