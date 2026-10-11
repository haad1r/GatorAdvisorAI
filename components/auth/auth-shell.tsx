import * as React from "react"
import Link from "next/link"
import { GraduationCapIcon } from "lucide-react"

/**
 * Page frame for sign-in, sign-up and onboarding.
 * Two columns on large screens (brand panel + content), single column
 * down to 375px. Navigation/theme are owned by the app shell, so this
 * deliberately has no nav bar.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-full flex-1 lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-muted p-10 lg:flex">
        <Brand />
        <div className="flex max-w-md flex-col gap-3">
          <p className="text-2xl font-semibold tracking-tight">
            Plan your UF degree with confidence.
          </p>
          <p className="text-sm text-muted-foreground">
            Degree audits, schedules and recommendations computed from UF
            requirements, explained in plain language.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Not an official UF service. Always confirm plans with your advisor.
        </p>
      </aside>

      <main className="flex flex-col gap-8 px-4 py-8 sm:px-8 lg:justify-center lg:py-12">
        <div className="lg:hidden">
          <Brand />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-col gap-6">
          {children}
        </div>
      </main>
    </div>
  )
}

function Brand() {
  return (
    <Link
      href="/"
      className="flex w-fit items-center gap-2 rounded-md font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <GraduationCapIcon aria-hidden="true" className="size-4" />
      </span>
      GatorAdvisor AI
    </Link>
  )
}

/** Heading block used at the top of each auth/onboarding page. */
export function AuthHeader({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <header className="flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </header>
  )
}
