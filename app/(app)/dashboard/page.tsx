import type { Metadata } from "next";
import { EmptyState } from "@/components/feedback/empty-state";

export const metadata: Metadata = { title: "Dashboard · GatorAdvisor" };

export default function DashboardPage() {
  return (
    <EmptyState
      size="lg"
      title="Your progress will appear here"
      description="Credits, percent complete, the next tracking deadline, and top recommendations show up once the audit API is available."
    />
  );
}
