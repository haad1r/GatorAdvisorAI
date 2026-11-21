"use client"

import { useMemo } from "react"
import { useAuth } from "@clerk/nextjs"
import { mockTransport } from "@/lib/mocks/transport"
import { createApiClient, type ApiClient } from "./client"
import { httpTransport } from "./transport"
import type { Transport } from "./types"

const USE_MOCKS = process.env.NEXT_PUBLIC_API_MOCKS === "true"
const LIVE = parseLive(process.env.NEXT_PUBLIC_API_LIVE)

/** "/api/profile, /api/courses" -> those paths and everything under them. */
export function parseLive(value: string | undefined) {
  return (value ?? "").split(",").map((p) => p.trim().replace(/\/$/, "")).filter(Boolean)
}

/** With mocks on, endpoints listed in NEXT_PUBLIC_API_LIVE still go to the real backend. */
export function isLive(path: string, live: string[] = LIVE) {
  const pathname = path.split("?")[0]
  return live.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/** The only way components should reach the backend. */
export function useApi(): ApiClient {
  const { getToken } = useAuth()
  return useMemo(() => {
    const http = httpTransport(() => getToken())
    const transport: Transport = (request) =>
      !USE_MOCKS || isLive(request.path) ? http(request) : mockTransport(request)
    return createApiClient(transport)
  }, [getToken])
}
