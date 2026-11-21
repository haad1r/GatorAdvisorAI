import { AppShell } from "@/components/nav/app-shell";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
