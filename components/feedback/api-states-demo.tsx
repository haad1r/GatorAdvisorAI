"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { ErrorPanel } from "@/components/feedback/error-panel"
import { LoadingBlock } from "@/components/feedback/loading-block"
import { StatusBadge } from "@/components/feedback/status-badge"
import { createApiClient } from "@/lib/api/client"
import { toErrorPanel } from "@/lib/api/errors"
import { hasErrors } from "@/lib/forms"
import type { ApiError, ApiResult, Coursework } from "@/lib/api/types"
import { resetMockStore } from "@/lib/mocks/handlers"
import {
  MOCK_SCENARIOS,
  getMockScenario,
  mockTransport,
  setMockScenario,
  type MockScenario,
} from "@/lib/mocks/transport"

type DemoState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; note: string; data: Coursework }
  | { kind: "error"; error: ApiError }

/* Always the mock server: /preview never talks to a real backend. */
const api = createApiClient(mockTransport)

const listeners = new Set<() => void>()
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function ApiStatesDemo() {
  const scenario = React.useSyncExternalStore(
    subscribe,
    () => getMockScenario() ?? "",
    () => ""
  )
  const [state, setState] = React.useState<DemoState>({ kind: "idle" })
  const [loaded, setLoaded] = React.useState<Coursework | null>(null)

  function changeScenario(value: string) {
    setMockScenario((value || null) as MockScenario | null)
    listeners.forEach((notify) => notify())
  }

  async function run(note: string, request: () => Promise<ApiResult<Coursework>>) {
    setState({ kind: "loading" })
    const result = await request()
    if (result.ok) {
      setLoaded(result.data)
      setState({ kind: "success", note, data: result.data })
    } else {
      setState({ kind: "error", error: result.error })
    }
  }

  async function saveTwiceFromSameCopy(copy: Coursework) {
    const first = await api.saveCoursework(copy)
    return first.ok ? api.saveCoursework(copy) : first
  }

  function withBadCourseCode(copy: Coursework): Coursework {
    const rows = copy.rows.map((r, i) => (i === 0 ? { ...r, courseCode: "cop 3502" } : r))
    return { ...copy, rows }
  }

  function reset() {
    resetMockStore()
    setLoaded(null)
    setState({ kind: "idle" })
  }

  const badge =
    state.kind === "idle" ? <StatusBadge kind="idle" label="Not loaded" />
    : state.kind === "loading" ? <StatusBadge kind="loading" label="Loading" />
    : state.kind === "success" ? <StatusBadge kind="success" label={state.note} />
    : <StatusBadge kind="error" label={state.error.code} />

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">API states (mock)</h2>
      <p className="text-sm text-muted-foreground">
        Calls the mock coursework API through the shared client. Pick a
        scenario to force an error, or use <code>?mock=&lt;scenario&gt;</code> in the URL.
      </p>

      <label className="flex flex-col gap-1 text-sm">
        Forced scenario
        <NativeSelect value={scenario} onChange={(e) => changeScenario(e.target.value)}>
          <option value="">None (normal responses)</option>
          {MOCK_SCENARIOS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </NativeSelect>
      </label>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => run("Loaded", api.getCoursework)}>
          Load coursework
        </Button>
        <Button size="sm" variant="outline" disabled={!loaded}
          onClick={() => loaded && run("Saved", () => api.saveCoursework(loaded))}>
          Save
        </Button>
        <Button size="sm" variant="outline" disabled={!loaded}
          onClick={() => loaded && run("Saved", () => saveTwiceFromSameCopy(loaded))}>
          Save twice (stale)
        </Button>
        <Button size="sm" variant="outline" disabled={!loaded}
          onClick={() => loaded && run("Saved", () => api.saveCoursework(withBadCourseCode(loaded)))}>
          Save bad course code
        </Button>
        <Button size="sm" variant="ghost" onClick={reset}>
          Reset mock data
        </Button>
      </div>

      <div aria-live="polite" className="flex flex-col gap-2">
        <div>{badge}</div>
        {state.kind === "loading" && <LoadingBlock />}
        {state.kind === "error" && (
          <>
            <ErrorPanel {...toErrorPanel(state.error)} />
            {state.error.fieldErrors && hasErrors(state.error.fieldErrors) && (
              <ul className="text-sm text-destructive">
                {Object.entries(state.error.fieldErrors).map(([field, msgs]) => (
                  <li key={field}><code>{field}</code>: {msgs?.join(" ")}</li>
                ))}
              </ul>
            )}
          </>
        )}
        {state.kind === "success" && (
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="mb-2 text-muted-foreground">Version {state.data.version}</p>
            <ul className="flex flex-col gap-1">
              {[...state.data.rows]
                .sort((a, b) => Number(b.status === "needs-review") - Number(a.status === "needs-review"))
                .map((row) => (
                  <li key={row.id} className="flex justify-between gap-2">
                    <span>{row.courseCode} · {row.grade} · {row.credits} cr · {row.term}</span>
                    {row.status === "needs-review" && (
                      <StatusBadge kind="loading" label="Needs review" />
                    )}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
