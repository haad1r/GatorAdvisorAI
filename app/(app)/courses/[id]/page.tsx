import type { Metadata } from "next";
import { CourseDetailView } from "@/components/courses/course-detail";

export const metadata: Metadata = { title: "Course · GatorAdvisor" };

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CourseDetailView id={decodeURIComponent(id)} />;
}
