import type { Metadata } from "next";
import { EmptyState } from "@/components/feedback/empty-state";

export const metadata: Metadata = { title: "Import · GatorAdvisor" };

export default function ImportPage() {
  return (
    <EmptyState
      size="lg"
      title="Nothing imported yet"
      description="Upload a transcript or enter courses by hand once the import step is connected."
    />
  );
}
