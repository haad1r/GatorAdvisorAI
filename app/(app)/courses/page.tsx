import type { Metadata } from "next";
import { EmptyState } from "@/components/feedback/empty-state";

export const metadata: Metadata = { title: "Courses · GatorAdvisor" };

export default function CoursesPage() {
  return (
    <EmptyState
      size="lg"
      title="Course search is coming"
      description="Search and filter UF courses by department, level, credits, and Gen Ed once the catalog API is available."
    />
  );
}
