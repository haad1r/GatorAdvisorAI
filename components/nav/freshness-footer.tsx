"use client"

import * as React from "react"
import { useApi } from "@/lib/api/use-api"
import type { DataFreshness } from "@/lib/api/types"

type State = { kind: "loading" } | { kind: "ok"; data: DataFreshness } | { kind: "error" }

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/New_York",
})

export function FreshnessFooter() {
  const api = useApi()
  const [state, setState] = React.useState<State>({ kind: "loading" })

  React.useEffect(() => {
    let live = true
    api.getDataFreshness().then((result) => {
      if (live) setState(result.ok ? { kind: "ok", data: result.data } : { kind: "error" })
    })
    return () => {
      live = false
    }
  }, [api])

  return (
    /* Mobile bottom padding clears the fixed tab bar (3.5rem + safe area). */
    <footer className="border-t border-border px-4 pt-3 pb-[calc(4.25rem+env(safe-area-inset-bottom))] text-xs text-muted-foreground sm:px-6 lg:px-8 lg:py-3">
      <p className="mx-auto max-w-6xl text-center">
        {state.kind === "ok" && (
          <>
            Catalog {state.data.catalogYear} · Schedule data updated{" "}
            <time dateTime={state.data.scheduleUpdatedAt}>
              {dateFormat.format(new Date(state.data.scheduleUpdatedAt))}
            </time>
            {" · "}
          </>
        )}
        {state.kind === "error" && "Data freshness is unavailable right now. "}
        Not an official UF service. Always confirm plans with your UF advisor.
      </p>
    </footer>
  )
}
