import { auth } from "@clerk/nextjs/server"
import { db } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/responses"
import type { Profile } from "@/lib/api/types"

export async function GET() {
    const { userId } = await auth()
    if (!userId) return fail("UNAUTHENTICATED", "Sign in to continue.")

    const { data, error } = await db()
    .from("profiles")
    .select("preferred_name, class_standing, program_id, catalog_year, entry_term, expected_graduation")
    .eq("user_id", userId)
    .maybeSingle()

    if (error) return fail("SERVER", "We couldn't load your profile.")
    if (!data) return fail("NOT_FOUND", "You haven't set up your profile yet.")

    const profile: Profile = {
        preferredName: data.preferred_name,
        classStanding: data.class_standing,
        major: data.program_id,
        catalogYear: data.catalog_year,
        entryTerm: data.entry_term,
        expectedGraduation: data.expected_graduation,
    }

    return ok(profile)
}
