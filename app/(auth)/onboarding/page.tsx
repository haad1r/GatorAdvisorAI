import type { Metadata } from "next"
import { AuthHeader } from "@/components/auth/auth-shell"
import { OnboardingForm } from "@/components/onboarding/onboarding-form"

export const metadata: Metadata = { title: "Set up your plan · GatorAdvisor AI" }

// TODO(auth): once Clerk is configured, protect this route and redirect
// signed-out users to /sign-in.
export default function OnboardingPage() {
  return (
    <>
      <AuthHeader
        title="Set up your plan"
        description="A few details so your degree audit uses the right requirements."
      />
      <OnboardingForm />
    </>
  )
}
