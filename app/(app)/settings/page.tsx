import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Settings · GatorAdvisor" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ account?: string | string[] }> }) {
  const { account } = await searchParams;
  return <SettingsView deleted={account === "deleted"} />;
}
