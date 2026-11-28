import type { Metadata } from "next";
import { ComingSoon } from "@/components/feedback/coming-soon";

export const metadata: Metadata = { title: "Recommendations · GatorAdvisor" };

export default function RecommendationsPage() {
  return (
    <ComingSoon
      id="recommendations-coming"
      preview="list"
      title="No recommendations yet"
      description="Suggested courses, with the reasons and the requirement each one fills, show here once the recommendations API is available."
      link={{ href: "/audit", label: "See the requirements you still need" }}
    />
  );
}
