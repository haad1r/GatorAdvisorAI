import type { Metadata } from "next";
import { EmptyState } from "@/components/feedback/empty-state";

export const metadata: Metadata = { title: "Schedule · GatorAdvisor" };

export default function SchedulePage() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">Schedule</h1>
      <EmptyState
        size="lg"
        title="No schedule yet"
        description="Term-by-term course plans will show here once the schedule API is available."
      />
    </>
  );
}
