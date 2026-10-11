"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ErrorPanel } from "@/components/feedback/error-panel"

/**
 * Shared full-page error pattern for `error.tsx` boundaries.
 * Never shows raw error messages (they can leak server details);
 * shows the digest so a user can quote it when reporting a bug.
 */
export function RouteError({
  error,
  retry,
  title = "Something went wrong",
  description = "We couldn't load this page. Try again, or head back home.",
}: {
  error: Error & { digest?: string }
  retry?: () => void
  title?: string
  description?: string
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-12">
      <ErrorPanel title={title} description={description} />
      {error.digest ? (
        <p className="text-xs text-muted-foreground">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {retry ? <Button onClick={() => retry()}>Try again</Button> : null}
        <Button variant="outline" render={<Link href="/" />} nativeButton={false}>
          Go home
        </Button>
      </div>
    </main>
  )
}
