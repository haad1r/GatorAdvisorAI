"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CalendarDaysIcon, ClipboardCheckIcon, HomeIcon, ListChecksIcon } from "lucide-react"
import { cn } from "cn"

const NAV_ITEMS = [
  { href: "/", label: "Home", short: "Home", icon: HomeIcon },
  { href: "/audit", label: "Degree audit", short: "Audit", icon: ClipboardCheckIcon },
  { href: "/schedule", label: "Schedule", short: "Schedule", icon: ListChecksIcon },
  { href: "/calendar", label: "Calendar", short: "Calendar", icon: CalendarDaysIcon },
] as const

function useIsActive() {
  const pathname = usePathname()
  return (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)
}

const focusRing = "outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

/** Inline links in the header, from lg up. */
export function HeaderNav() {
  const isActive = useIsActive()
  return (
    <nav aria-label="Primary" className="hidden lg:block">
      <ul className="flex items-center gap-2">
        {NAV_ITEMS.map(({ href, label }) => {
          const active = isActive(href)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center rounded-xl px-5 text-base transition-colors",
                  focusRing,
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Fixed bottom tab bar below lg. The active tab gets a bar and bold label, not just color. */
export function MobileTabBar() {
  const isActive = useIsActive()
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="grid grid-cols-4">
        {NAV_ITEMS.map(({ href, short, icon: Icon }) => {
          const active = isActive(href)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs transition-colors",
                  focusRing,
                  active ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {active && (
                  <span aria-hidden="true" className="absolute top-0 h-0.5 w-8 rounded-full bg-foreground" />
                )}
                <Icon aria-hidden="true" className="size-5" />
                {short}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
