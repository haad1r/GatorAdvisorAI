import type { ApiError, Transport } from "@/lib/api/types"
import { routes } from "./handlers"

/*
 * Force an error state with ?mock=<scenario> in the URL. It sticks in
 * localStorage until ?mock=off.
 */
export const MOCK_SCENARIOS = [
  "expired",
  "forbidden",
  "validation",
  "quota",
  "stale",
  "network",
  "server",
  "slow",
] as const

export type MockScenario = (typeof MOCK_SCENARIOS)[number]

const STORAGE_KEY = "api-mock-scenario"

/* Apply ?mock= once per URL, so a later setMockScenario() isn't overridden. */
let appliedSearch: string | null = null

export function getMockScenario(): MockScenario | null {
  if (typeof window === "undefined") return null
  try {
    if (window.location.search !== appliedSearch) {
      appliedSearch = window.location.search
      const fromUrl = new URLSearchParams(appliedSearch).get("mock")
      if (fromUrl === "off") localStorage.removeItem(STORAGE_KEY)
      else if (isScenario(fromUrl)) localStorage.setItem(STORAGE_KEY, fromUrl)
    }
    const saved = localStorage.getItem(STORAGE_KEY)
    return isScenario(saved) ? saved : null
  } catch {
    return null
  }
}

export function setMockScenario(scenario: MockScenario | null) {
  try {
    if (scenario) localStorage.setItem(STORAGE_KEY, scenario)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

function isScenario(value: string | null): value is MockScenario {
  return MOCK_SCENARIOS.includes(value as MockScenario)
}

const FORCED: Record<Exclude<MockScenario, "slow">, ApiError> = {
  expired: { code: "UNAUTHENTICATED", message: "Your session expired. Sign in again to continue." },
  forbidden: { code: "FORBIDDEN", message: "You don't have access to this." },
  validation: { code: "VALIDATION_ERROR", message: "Some fields need fixing.", fieldErrors: {} },
  quota: { code: "QUOTA_EXCEEDED", message: "Too many requests. Try again shortly.", retryAfterSeconds: 30 },
  stale: { code: "STALE_WRITE", message: "Your courses were changed somewhere else. Reload to see the latest before saving." },
  network: { code: "NETWORK", message: "You appear to be offline." },
  server: { code: "SERVER", message: "Something went wrong on our side." },
}

const WRITE_ONLY: MockScenario[] = ["validation", "stale"]

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const mockTransport: Transport = async ({ method, path, body }) => {
  const scenario = getMockScenario()
  await wait(scenario === "slow" ? 3000 : 300 + Math.random() * 400)

  if (scenario && scenario !== "slow") {
    const appliesHere = method !== "GET" || !WRITE_ONLY.includes(scenario)
    if (appliesHere) return { ok: false, error: FORCED[scenario] }
  }

  const handler = routes[`${method} ${path}`]
  if (!handler) {
    return { ok: false, error: { code: "NOT_FOUND", message: `No mock for ${method} ${path}.` } }
  }

  return handler(structuredClone(body))
}
