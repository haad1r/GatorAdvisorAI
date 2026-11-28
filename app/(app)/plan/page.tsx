import type { Metadata } from "next";
import { ComingSoon } from "@/components/feedback/coming-soon";

export const metadata: Metadata = { title: "Plan · GatorAdvisor" };

export default function PlanPage() {
  return (
    <ComingSoon
      id="plan-coming"
      preview="board"
      title="No plan yet"
      description="Your term-by-term plan, credits per term, and warnings show here once the planning API is available."
      link={{ href: "/audit", label: "See what's left in your degree audit" }}
    />
  );
}
