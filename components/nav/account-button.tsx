"use client"

import Link from "next/link"
import { UserButton, useAuth } from "@clerk/nextjs"
import { MoonIcon, SunIcon } from "lucide-react"
import { cn } from "cn"
import { buttonVariants } from "@/components/ui/button"
import { useTheme } from "@/components/theme/theme-toggle"

/*
 * Signed in: Clerk's menu (manage account, sign out) plus a theme item.
 * Signed out: a sign-in link. Display only; it protects no route.
 */
export function AccountButton({ showName = false }: { showName?: boolean }) {
  const { isLoaded, isSignedIn } = useAuth()
  const { dark, toggle } = useTheme()

  if (!isLoaded) return <div aria-hidden="true" className="h-11" />

  if (isSignedIn) {
    return (
      <UserButton
        showName={showName}
        appearance={{
          /*
           * Style objects, not Tailwind classes: Clerk's own CSS outranks utility
           * classes, but objects are merged into its styles. Laid out like a nav row: avatar, then name.
           */
          elements: showName
            ? {
                rootBox: { width: "100%" },
                userButtonTrigger: {
                  width: "100%",
                  height: "2.75rem",
                  padding: "0 0.75rem 0 0.5rem",
                  borderRadius: "0.75rem",
                  "&:hover": { backgroundColor: "color-mix(in oklch, var(--muted) 60%, transparent)" },
                },
                userButtonBox: { width: "100%", flexDirection: "row", alignItems: "center", gap: "3px" },
                userButtonOuterIdentifier: {
                  order: 2,
                  flex: 1,
                  textAlign: "left",
                  fontSize: "18px",
                  fontWeight: 400,
                  lineHeight: 1,
                  color: "var(--foreground)",
                },
                avatarBox: { order: 1, width: "1.625rem", height: "1.625rem" },
              }
            : { avatarBox: { width: "2.25rem", height: "2.25rem" } },
        }}
      >
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
    <Link
      href="/sign-in"
      className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full rounded-xl text-[15px]")}
    >
      Sign in
    </Link>
  )
}
