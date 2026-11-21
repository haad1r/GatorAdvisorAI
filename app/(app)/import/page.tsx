import type { Metadata } from "next";
import { ImportView } from "@/components/import/import-view";

export const metadata: Metadata = { title: "Import · GatorAdvisor" };

export default function ImportPage() {
  return <ImportView />;
}
