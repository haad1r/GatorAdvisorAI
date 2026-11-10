"use client"

import Link from "next/link"
import { UserButton, useAuth } from "@clerk/nextjs"
import { MoonIcon, SunIcon } from "lucide-react"
import { cn } from "cn"
import { buttonVariants } from "@/components/ui/button"
import { ThemeToggle, useTheme } from "@/components/theme/theme-toggle"

/*
 * Signed in: the theme choice lives in the profile menu. Signed out: a
 * standalone toggle plus a sign-in link. Display only; it protects no route.
 */
export function AccountButton() {
  const { isLoaded, isSignedIn } = useAuth()
  const { dark, toggle } = useTheme()

  if (!isLoaded) return <div aria-hidden="true" className="size-10 lg:size-11" />

  if (isSignedIn) {
    return (
      <UserButton appearance={{ elements: { avatarBox: "size-10 lg:size-11" } }}>
        <UserButton.MenuItems>
          <UserButton.Action
            label={dark ? "Light mode" : "Dark mode"}
            labelIcon={dark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
            onClick={toggle}
          />
        </UserButton.MenuItems>
      </UserButton>
    )
  }

  return (
    <>
      <ThemeToggle className="size-10 lg:size-11 lg:rounded-xl" iconClassName="size-5 lg:size-[22px]" />
      <Link
        href="/sign-in"
        className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4 text-[15px] lg:h-11 lg:rounded-xl lg:px-5 lg:text-base")}
      >
        Sign in
      </Link>
    </>
  )
}
