import type { Metadata } from "next";
import { ComingSoon } from "@/components/feedback/coming-soon";

export const metadata: Metadata = { title: "Advisor · GatorAdvisor" };

export default function AdvisorPage() {
  return (
    <ComingSoon
      id="advisor-coming"
      preview="chat"
      title="Advisor chat is coming"
      description="Ask questions about your plan and get answers with sources once the advisor API is available."
      link={{ href: "/audit", label: "Open your degree audit" }}
    />
  );
}
