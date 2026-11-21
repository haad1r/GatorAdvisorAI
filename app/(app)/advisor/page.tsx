import type { Metadata } from "next";
import { EmptyState } from "@/components/feedback/empty-state";

export const metadata: Metadata = { title: "Advisor · GatorAdvisor" };

export default function AdvisorPage() {
  return (
    <EmptyState
      size="lg"
      title="Advisor chat is coming"
      description="Ask questions about your plan and get answers with sources once the advisor API is available."
    />
  );
}
