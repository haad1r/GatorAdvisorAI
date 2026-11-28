"use client"

import Link from "next/link"
import { SignOutButton, useAuth } from "@clerk/nextjs"
import { Button } from "@/components/ui/button"

const GONE = "Your profile, courses, survey answers, plans, schedules, and chats are gone"

/** Says "signed out" only once Clerk confirms the session is gone. */
export function AccountDeleted() {
  const { isLoaded, isSignedIn } = useAuth()

  return (
    <section role="status" className="w-full max-w-[25rem] rounded-2xl border border-border bg-card p-8">
      <h2 className="text-lg font-semibold">Your account was deleted</h2>
      {!isLoaded ? (
        <p className="mt-2 text-sm text-muted-foreground">{GONE}.</p>
      ) : isSignedIn ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">{GONE}. Sign out to finish.</p>
          <SignOutButton redirectUrl="/account-deleted">
            <Button className="mt-5 w-full">Sign out</Button>
          </SignOutButton>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">{GONE}, and you&apos;ve been signed out.</p>
          <Button className="mt-5 w-full" variant="outline" render={<Link href="/sign-up" />} nativeButton={false}>
            Create a new account
          </Button>
        </>
      )}
    </section>
  )
}
