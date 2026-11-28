import type { Metadata } from "next";
import { ComingSoon } from "@/components/feedback/coming-soon";

export const metadata: Metadata = { title: "Courses · GatorAdvisor" };

export default function CoursesPage() {
  return (
    <ComingSoon
      id="courses-coming"
      preview="table"
      title="Course search is coming"
      description="Search and filter UF courses by department, level, credits, and Gen Ed once the catalog API is available."
      link={{ href: "/import", label: "See the courses you've taken" }}
    />
  );
}
