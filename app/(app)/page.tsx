import type { Metadata } from "next";
import { EmptyState } from "@/components/feedback/empty-state";

export const metadata: Metadata = { title: "Home · GatorAdvisor" };

export default function HomePage() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">Home</h1>
      <EmptyState
        size="lg"
        title="Your overview will appear here"
        description="Progress, upcoming deadlines, and next steps show up once the degree audit and schedule are connected."
      />
    </>
  );
}
