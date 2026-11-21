import { AccountButton } from "./account-button"
import { LogoLink } from "./logo-link"
import { NavList } from "./nav-links"

/** Logo, main pages, then Settings and account. Shared by the desktop sidebar and the mobile menu. */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <LogoLink className="self-start px-1" />
      <nav aria-label="Primary" className="flex-1 overflow-y-auto">
        <NavList list="main" onNavigate={onNavigate} />
      </nav>
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <NavList list="settings" onNavigate={onNavigate} />
        <AccountButton showName />
      </div>
    </>
  )
}
