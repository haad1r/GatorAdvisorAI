import type { Metadata } from "next";
import { EmptyState } from "@/components/feedback/empty-state";

export const metadata: Metadata = { title: "Settings · GatorAdvisor" };

export default function SettingsPage() {
  return (
    <EmptyState
      size="lg"
      title="Settings are coming"
      description="Profile and program, retaking the survey, re-importing, and account deletion live here once the backend is connected."
    />
  );
}
