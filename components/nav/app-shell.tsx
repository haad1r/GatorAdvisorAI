import { ThemeToggle } from "@/components/theme/theme-toggle"
import { AccountButton } from "./account-button"
import { FreshnessFooter } from "./freshness-footer"
import { LogoLink } from "./logo-link"
import { MobileMenu } from "./mobile-menu"
import { MobileTabBar, NavList, PageTitle } from "./nav-links"
import { ProgramSummary } from "./program-summary"

/*
 * #21 shell. Desktop (lg+): left sidebar plus a top bar with the page title,
 * program, and theme toggle. Below lg: top bar with a menu button, and a
 * bottom tab bar for the 5 most used pages.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-background px-3 py-2 text-sm font-medium ring-3 ring-ring/50 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <div className="flex min-h-dvh w-full lg:grid lg:grid-cols-[16rem_1fr]">
        <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-border px-4 py-5 lg:flex">
          <LogoLink className="self-start px-1" />
          <nav aria-label="Primary" className="flex-1 overflow-y-auto">
            <NavList list="main" />
          </nav>
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <NavList list="settings" />
            <AccountButton showName />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
            <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:h-20 lg:px-8">
              <div className="lg:hidden">
                <MobileMenu />
              </div>
              <div className="min-w-0 flex-1">
                <PageTitle className="truncate text-xl font-semibold tracking-tight lg:text-2xl" />
                <ProgramSummary className="hidden truncate text-sm text-muted-foreground sm:block" />
              </div>
              <ThemeToggle className="size-10 lg:size-11 lg:rounded-xl" iconClassName="size-5 lg:size-[22px]" />
            </div>
          </header>

          <main
            id="main"
            tabIndex={-1}
            className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 outline-none sm:px-6 lg:gap-8 lg:px-8 lg:py-10"
          >
            {children}
          </main>

          <FreshnessFooter />
        </div>
      </div>

      <MobileTabBar />
    </>
  )
}
