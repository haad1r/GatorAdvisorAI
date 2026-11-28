import type { Metadata } from "next"
import { SurveyRetake } from "@/components/onboarding/survey-retake"

export const metadata: Metadata = { title: "Interest survey · GatorAdvisor" }

export default function SurveyPage() {
  return <SurveyRetake />
}
