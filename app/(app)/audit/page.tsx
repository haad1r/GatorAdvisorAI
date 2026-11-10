import type { Metadata } from "next";
import { EmptyState } from "@/components/feedback/empty-state";

export const metadata: Metadata = { title: "Degree audit · GatorAdvisor" };

export default function AuditPage() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">Degree audit</h1>
      <EmptyState
        size="lg"
        title="No audit yet"
        description="Your requirement progress will show here once the audit API is available."
      />
    </>
  );
}
