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
                "group/nav relative flex h-11 items-center gap-3 rounded-lg px-3 text-[15px] transition-colors",
                focusRing,
                /* Active is a raised pill plus bold text, not color alone. */
                active
                  ? "bg-background font-semibold text-foreground shadow-[0_1px_2px_rgba(14,21,37,0.06)] ring-1 ring-border"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon aria-hidden="true" className={cn("size-[18px] shrink-0", active && "text-brand-orange")} />
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
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
                  active ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {active && (
                  <span aria-hidden="true" className="absolute top-0 h-0.5 w-8 rounded-full bg-brand-orange" />
                )}
                <Icon aria-hidden="true" className={cn("size-5", active && "text-brand-orange")} />
                {short ?? label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
