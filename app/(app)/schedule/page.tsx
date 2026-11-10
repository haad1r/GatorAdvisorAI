import type { Metadata } from "next";
import { EmptyState } from "@/components/feedback/empty-state";

export const metadata: Metadata = { title: "Schedule · GatorAdvisor" };

export default function SchedulePage() {
  return (
    <EmptyState
      size="lg"
      title="No schedule yet"
      description="Your weekly class calendar and agenda show here once the schedule API is available."
    />
  );
}
