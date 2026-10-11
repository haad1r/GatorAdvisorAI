import type { Metadata } from "next"
import Link from "next/link"
import { AuthHeader } from "@/components/auth/auth-shell"
import { ClerkSlot } from "@/components/auth/clerk-slot"

export const metadata: Metadata = { title: "Sign in · GatorAdvisor AI" }

// Optional catch-all ([[...sign-in]]) because Clerk's <SignIn /> uses
// sub-paths for its own steps (e.g. /sign-in/factor-one).
export default function SignInPage() {
  return (
    <>
      <AuthHeader
        title="Welcome back"
        description="Sign in to see your degree audit and saved schedules."
      />
      <ClerkSlot flow="sign-in" />
      <p className="text-sm text-muted-foreground">
        New to GatorAdvisor?{" "}
        <Link href="/sign-up" className="font-medium text-foreground underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </>
  )
}
