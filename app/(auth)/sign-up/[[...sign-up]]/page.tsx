import type { Metadata } from "next"
import Link from "next/link"
import { AuthHeader } from "@/components/auth/auth-shell"
import { ClerkSlot } from "@/components/auth/clerk-slot"

export const metadata: Metadata = { title: "Create account · GatorAdvisor AI" }

export default function SignUpPage() {
  return (
    <>
      <AuthHeader
        title="Create your account"
        description="It takes about two minutes. We'll set up your degree plan next."
      />
      <ClerkSlot flow="sign-up" />
      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </>
  )
}
