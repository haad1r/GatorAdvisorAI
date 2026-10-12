import type { Metadata } from "next"
import { OnboardingForm } from "../../../components/onboarding/onboarding-form"

export const metadata: Metadata = { title: "Set up your plan · GatorAdvisor AI" }

// TODO(auth): once Clerk is configured, protect this route and redirect
// signed-out users to /sign-in.
export default function OnboardingPage() {
  return (
    <>
      <OnboardingForm />
    </>
  )
}