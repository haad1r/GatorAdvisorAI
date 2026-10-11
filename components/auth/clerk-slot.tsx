import { EmptyState } from "@/components/feedback/empty-state"

/**
 * Placeholder where Clerk's prebuilt <SignIn /> / <SignUp /> components
 * will mount once Clerk is configured (TEAM-01 owns provider setup and
 * the publishable key). We intentionally do NOT build our own credential
 * form — Clerk is the only auth UI.
 *
 * When Clerk is ready, replace this with e.g.:
 *   <SignIn path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl="/onboarding" />
 */
export function ClerkSlot({ flow }: { flow: "sign-in" | "sign-up" }) {
  return (
    <div data-clerk-slot={flow} className="min-h-64">
      <EmptyState
        title={flow === "sign-in" ? "Sign-in form" : "Sign-up form"}
        description="Clerk's form appears here once authentication is configured."
      />
    </div>
  )
}
