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
  expectedGraduation: string
}

export const emptyProfile: OnboardingProfile = {
  preferredName: "",
  classStanding: "",
  major: "",
  catalogYear: "",
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

export const PLACEHOLDER_GRAD_TERMS: Option[] = [
  "Spring 2027",
  "Fall 2027",
  "Spring 2028",
  "Fall 2028",
  "Spring 2029",
  "Fall 2029",
  "Spring 2030",
].map((t) => ({ value: t, label: t }))

/** Human-readable labels, used by FormErrorSummary links and the review step. */
export const PROFILE_LABELS: Record<keyof OnboardingProfile, string> = {
  preferredName: "Preferred name",
  classStanding: "Class standing",
  major: "Major",
  catalogYear: "Catalog year",
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
    fields: ["major", "catalogYear", "expectedGraduation"],
  },
  { id: "review", title: "Review", fields: [] },
] as const satisfies ReadonlyArray<{
  id: string
  title: string
  fields: ReadonlyArray<keyof OnboardingProfile>
}>

const NAME_MAX = 50

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
      case "expectedGraduation":
        if (!oneOf(PLACEHOLDER_GRAD_TERMS, value))
          add(field, "Choose when you expect to graduate.")
        break
    }
  }
  return errors
}
