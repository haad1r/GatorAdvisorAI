"use client"

import Link from "next/link"
import { UserButton, useAuth } from "@clerk/nextjs"
import { cn } from "cn"
import { buttonVariants } from "@/components/ui/button"

/* Display only: picks the button by session state. It does not protect any route. */
export function AccountButton() {
  const { isLoaded, isSignedIn } = useAuth()

  if (!isLoaded) return <div aria-hidden="true" className="size-10 lg:size-11" />
  if (isSignedIn) return <UserButton appearance={{ elements: { avatarBox: "size-10 lg:size-11" } }} />
  return (
    <Link href="/sign-in" className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4 text-[15px] lg:h-11 lg:rounded-xl lg:px-5 lg:text-base")}>
      Sign in
    </Link>
  )
}
