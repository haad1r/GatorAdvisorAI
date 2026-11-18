"use client"

import * as React from "react"
import type { ApiError, ApiResult } from "./types"

export type Load<T> = { kind: "loading" } | { kind: "ok"; data: T } | { kind: "error"; error: ApiError }

/**
 * Runs one API call on mount, with a retry. `fetcher` must be stable: wrap it
 * in useCallback with `api` as the dependency.
 */
export function useLoad<T>(fetcher: () => Promise<ApiResult<T>>) {
  const [state, setState] = React.useState<Load<T>>({ kind: "loading" })
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    let live = true
    fetcher().then((result) => {
      if (!live) return
      setState(result.ok ? { kind: "ok", data: result.data } : { kind: "error", error: result.error })
    })
    return () => {
      live = false
    }
  }, [fetcher, attempt])

  const retry = React.useCallback(() => {
    setState({ kind: "loading" })
    setAttempt((n) => n + 1)
  }, [])

  return { state, retry }
}
