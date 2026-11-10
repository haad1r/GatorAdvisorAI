import type { Metadata } from "next";
import { EmptyState } from "@/components/feedback/empty-state";

export const metadata: Metadata = { title: "Degree audit · GatorAdvisor" };

export default function AuditPage() {
  return (
    <EmptyState
      size="lg"
      title="No audit yet"
      description="Requirement groups for your major, Gen Ed, minor, and tracking will show here once the audit API is available."
    />
  );
}
