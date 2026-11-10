import type { Metadata } from "next";
import { ScheduleView } from "@/components/calendar/schedule-view";

export const metadata: Metadata = { title: "Schedule · GatorAdvisor" };

export default function SchedulePage() {
  return <ScheduleView />;
}
