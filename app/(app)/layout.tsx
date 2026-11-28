import { AppShell } from "@/components/nav/app-shell";
import { ProfileGate } from "@/components/nav/profile-gate"

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell>
      <ProfileGate />
      {children}
    </AppShell>
  );
}
