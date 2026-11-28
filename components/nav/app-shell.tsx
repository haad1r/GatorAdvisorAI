import { ThemeToggle } from "@/components/theme/theme-toggle"
import { FreshnessFooter } from "./freshness-footer"
import { MobileMenu } from "./mobile-menu"
import { MobileTabBar, PageTitle } from "./nav-links"
import { ProgramSummary } from "./program-summary"
import { SidebarContent } from "./sidebar-content"

/*
 * #21 shell. Desktop (lg+): left sidebar on the page canvas, and the content
 * on a white sheet with a top bar (page title, program, theme toggle). Below
 * lg: top bar with a menu button, and a bottom tab bar for the 5 most used pages.
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

      <div className="flex min-h-dvh w-full bg-canvas lg:grid lg:grid-cols-[15rem_1fr]">
        <aside className="sticky top-0 hidden h-dvh flex-col gap-7 px-3 py-5 lg:flex">
          <SidebarContent />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col bg-background lg:my-3 lg:mr-3 lg:rounded-2xl lg:shadow-[0_1px_2px_rgba(14,21,37,0.05)] lg:ring-1 lg:ring-border">
          <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-md lg:static lg:rounded-t-2xl lg:bg-transparent lg:backdrop-blur-none">
            <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6 lg:h-auto lg:px-12 lg:pt-10 lg:pb-2">
              <div className="lg:hidden">
                <MobileMenu />
              </div>
              <div className="min-w-0 flex-1">
                <PageTitle className="truncate text-xl font-semibold tracking-tight text-foreground lg:text-[28px] lg:leading-tight" />
                <ProgramSummary className="hidden truncate text-sm text-muted-foreground sm:block lg:mt-1" />
              </div>
              <ThemeToggle
                className="size-10 rounded-full border-transparent bg-muted hover:bg-accent dark:border-transparent dark:bg-muted"
                iconClassName="size-[18px]"
              />
            </div>
          </header>

          <main
            id="main"
            tabIndex={-1}
            className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 pt-4 pb-10 outline-none has-[[data-wide]]:max-w-[100rem] sm:px-6 lg:gap-12 lg:px-12 lg:pt-8 lg:pb-14"
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
