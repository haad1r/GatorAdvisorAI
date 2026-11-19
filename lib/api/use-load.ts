"use client"

import * as React from "react"
import type { ApiError, ApiResult } from "./types"

export type Load<T> = { kind: "loading" } | { kind: "ok"; data: T } | { kind: "error"; error: ApiError }

const LOADING = { kind: "loading" } as const

/**
 * Runs one API call on mount, and again whenever `fetcher` changes, with a
 * retry. `fetcher` must be stable: wrap it in useCallback with `api` and its
 * inputs as the dependencies. A new fetcher shows loading, never the previous
 * fetcher's result.
 */
export function useLoad<T>(fetcher: () => Promise<ApiResult<T>>) {
  const [result, setResult] = React.useState<{ for: typeof fetcher; load: Load<T> } | null>(null)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    let live = true
    fetcher().then((r) => {
      if (!live) return
      setResult({ for: fetcher, load: r.ok ? { kind: "ok", data: r.data } : { kind: "error", error: r.error } })
    })
    return () => {
      live = false
    }
  }, [fetcher, attempt])

  const retry = React.useCallback(() => {
    setResult(null)
    setAttempt((n) => n + 1)
  }, [])

  const state: Load<T> = result && result.for === fetcher ? result.load : LOADING
  return { state, retry }
}
