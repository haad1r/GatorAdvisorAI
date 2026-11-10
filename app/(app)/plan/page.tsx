import type { Metadata } from "next";
import { EmptyState } from "@/components/feedback/empty-state";

export const metadata: Metadata = { title: "Plan · GatorAdvisor" };

export default function PlanPage() {
  return (
    <EmptyState
      size="lg"
      title="No plan yet"
      description="Your term-by-term plan, credits per term, and warnings show here once the planning API is available."
    />
  );
}
