import Image from "next/image"
import Link from "next/link"
import { AccountButton } from "./account-button"
import { HeaderNav, MobileTabBar } from "./nav-links"

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-background px-3 py-2 text-sm font-medium ring-3 ring-ring/50 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        {/* lg+: three columns with equal outer widths, so the links sit at the true center. */}
        <div className="flex h-16 w-full items-center gap-4 px-4 sm:px-6 lg:grid lg:h-20 lg:grid-cols-[1fr_auto_1fr]">
          <Link
            href="/"
            aria-label="GatorAdvisor home"
            className="shrink-0 justify-self-start rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Image src="/logo-mark.png" alt="" width={206} height={48} priority className="h-10 w-auto lg:h-12 dark:hidden" />
            <Image src="/logo-mark-dark.png" alt="" width={206} height={48} priority className="hidden h-10 w-auto lg:h-12 dark:block" />
          </Link>
          <HeaderNav />
          <div className="ml-auto flex items-center gap-2 justify-self-end lg:gap-3">
            <AccountButton />
          </div>
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pt-8 pb-28 outline-none sm:px-6 lg:gap-8 lg:px-8 lg:pt-12 lg:pb-16"
      >
        {children}
      </main>

      <MobileTabBar />
    </>
  )
}
