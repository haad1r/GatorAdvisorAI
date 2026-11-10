import type { Metadata } from "next";
import { EmptyState } from "@/components/feedback/empty-state";

export const metadata: Metadata = { title: "Calendar · GatorAdvisor" };

export default function CalendarPage() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">Calendar</h1>
      <EmptyState
        size="lg"
        title="No events yet"
        description="Your weekly calendar and agenda will show here once the calendar API is available."
      />
    </>
  );
}
