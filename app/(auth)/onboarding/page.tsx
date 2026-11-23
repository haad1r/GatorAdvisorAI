import type { Metadata } from "next"
import { OnboardingForm } from "../../../components/onboarding/onboarding-form"

export const metadata: Metadata = { title: "Set up your plan · GatorAdvisor AI" }

export default function OnboardingPage() {
  return (
    <>
      <OnboardingForm />
    </>
  )
}