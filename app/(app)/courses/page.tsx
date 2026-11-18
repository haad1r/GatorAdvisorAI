import type { Metadata } from "next";
import { Suspense } from "react";
import { CourseSearch } from "@/components/courses/course-search";
import { LoadingBlock } from "@/components/feedback/loading-block";

export const metadata: Metadata = { title: "Courses · GatorAdvisor" };

export default function CoursesPage() {
  // CourseSearch reads the URL's query string, which needs a Suspense boundary.
  return (
    <Suspense fallback={<LoadingBlock />}>
      <CourseSearch />
    </Suspense>
  );
}
