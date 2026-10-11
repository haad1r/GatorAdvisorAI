import { AuthShell } from "@/components/auth/auth-shell"

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <AuthShell>{children}</AuthShell>
}
