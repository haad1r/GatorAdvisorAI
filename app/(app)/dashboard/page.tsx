import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Dashboard · GatorAdvisor" };

export default function DashboardPage() {
  return <DashboardView />;
}
