import {
  BookOpenIcon,
  CalendarDaysIcon,
  ClipboardCheckIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MessageSquareTextIcon,
  RouteIcon,
  SettingsIcon,
  SparklesIcon,
  UploadIcon,
} from "lucide-react"

export type NavItem = {
  href: string
  label: string
  /** Shorter label for the mobile tab bar. */
  short?: string
  icon: LucideIcon
  /** One of the 5 pages in the mobile tab bar. */
  tab?: boolean
}

/* The #21 page map. Order is the sidebar order. */
export const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", short: "Home", icon: LayoutDashboardIcon, tab: true },
  { href: "/audit", label: "Degree audit", short: "Audit", icon: ClipboardCheckIcon, tab: true },
  { href: "/courses", label: "Courses", icon: BookOpenIcon },
  { href: "/recommendations", label: "Recommendations", icon: SparklesIcon },
  { href: "/plan", label: "Plan", icon: RouteIcon, tab: true },
  { href: "/schedule", label: "Schedule", icon: CalendarDaysIcon, tab: true },
  { href: "/advisor", label: "Advisor", icon: MessageSquareTextIcon, tab: true },
  { href: "/import", label: "Import", icon: UploadIcon },
]

export const SETTINGS_NAV: NavItem = { href: "/settings", label: "Settings", icon: SettingsIcon }

export const ALL_NAV = [...MAIN_NAV, SETTINGS_NAV]

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function titleFor(pathname: string) {
  return ALL_NAV.find((item) => isActive(pathname, item.href))?.label ?? "GatorAdvisor"
}
