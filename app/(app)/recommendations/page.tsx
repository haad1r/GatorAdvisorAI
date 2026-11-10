import type { Metadata } from "next";
import { EmptyState } from "@/components/feedback/empty-state";

export const metadata: Metadata = { title: "Recommendations · GatorAdvisor" };

export default function RecommendationsPage() {
  return (
    <EmptyState
      size="lg"
      title="No recommendations yet"
      description="Suggested courses, with the reasons and the requirement each one fills, show here once the recommendations API is available."
    />
  );
}
