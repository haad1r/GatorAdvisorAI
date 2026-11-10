"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "cn"
import { MAIN_NAV, SETTINGS_NAV, isActive, titleFor } from "./nav-items"

const TAB_ITEMS = MAIN_NAV.filter((item) => item.tab)

export const focusRing = "outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

/** The current page's name, from the nav list. Rendered as the page's only <h1>. */
export function PageTitle({ className }: { className?: string }) {
  return <h1 className={className}>{titleFor(usePathname())}</h1>
}

/* Lists are picked by name: nav items hold icon components, which can't be passed from a server component. */
const LISTS = { main: MAIN_NAV, settings: [SETTINGS_NAV] }

/** Vertical links with icons, used by the desktop sidebar and the mobile menu. */
export function NavList({ list, onNavigate }: { list: keyof typeof LISTS; onNavigate?: () => void }) {
  const pathname = usePathname()
  const items = LISTS[list]
  return (
    <ul className="flex flex-col gap-1">
      {items.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href)
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors",
                focusRing,
                active
                  ? "bg-brand-blue/10 font-medium text-brand-blue"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              {active && (
                <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-full bg-brand-blue" />
              )}
              <Icon aria-hidden="true" className="size-5 shrink-0" />
              {label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Fixed bottom tab bar below lg. The active tab gets a bar and bold label, not just color. */
export function MobileTabBar() {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {TAB_ITEMS.map(({ href, label, short, icon: Icon }) => {
          const active = isActive(pathname, href)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs transition-colors",
                  focusRing,
                  active ? "font-semibold text-brand-blue" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {active && (
                  <span aria-hidden="true" className="absolute top-0 h-0.5 w-8 rounded-full bg-brand-blue" />
                )}
                <Icon aria-hidden="true" className="size-5" />
                {short ?? label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
