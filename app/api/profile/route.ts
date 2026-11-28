import { auth, currentUser } from "@clerk/nextjs/server"
import { db } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/responses"
import { hasErrors } from "@/lib/forms"
import { validateProfile } from "@/lib/onboarding"
import type { Profile } from "@/lib/api/types"

const COLUMNS = "preferred_name, class_standing, program_id, catalog_year, entry_term, expected_graduation"

type ProfileRow = {
  preferred_name: string
  class_standing: string
  program_id: string
  catalog_year: string
  entry_term: string
  expected_graduation: string
}

function toProfile(row: ProfileRow): Profile {
  return {
    preferredName: row.preferred_name,
    classStanding: row.class_standing,
    major: row.program_id,
    catalogYear: row.catalog_year,
    entryTerm: row.entry_term,
    expectedGraduation: row.expected_graduation,
  }
}

function toRow(profile: Profile): ProfileRow {
  return {
    preferred_name: profile.preferredName,
    class_standing: profile.classStanding,
    program_id: profile.major,
    catalog_year: profile.catalogYear,
    entry_term: profile.entryTerm,
    expected_graduation: profile.expectedGraduation,
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return fail("UNAUTHENTICATED", "Sign in to continue.")

  const { data, error } = await db()
    .from("profiles")
    .select(COLUMNS)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) return fail("SERVER", "We couldn't load your profile.")
  if (!data) return fail("NOT_FOUND", "You haven't set up your profile yet.")

  return ok(toProfile(data))
}

export async function PUT(request: Request) {
  const { userId } = await auth()
  if (!userId) return fail("UNAUTHENTICATED", "Sign in to continue.")

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") return fail("VALIDATION_ERROR", "Send the profile as JSON.")

  const profile: Profile = {
    preferredName: text(body.preferredName),
    classStanding: text(body.classStanding),
    major: text(body.major),
    catalogYear: text(body.catalogYear),
    entryTerm: text(body.entryTerm),
    expectedGraduation: text(body.expectedGraduation),
  }

  const errors = validateProfile(profile)
  if (hasErrors(errors)) return fail("VALIDATION_ERROR", "Some fields need fixing.", errors)

  const user = await currentUser()
  const email = user?.primaryEmailAddress?.emailAddress
  if (!email) return fail("VALIDATION_ERROR", "Your account needs an email address.")

  const { data, error } = await db()
    .from("profiles")
    .upsert(
      { user_id: userId, email, ...toRow(profile), updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    )
    .select(COLUMNS)
    .single()

  if (error) return fail("SERVER", "We couldn't save your profile.")

  return ok(toProfile(data))
}
