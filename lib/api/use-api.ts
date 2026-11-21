"use client"

import { useMemo } from "react"
import { useAuth } from "@clerk/nextjs"
import { mockTransport } from "@/lib/mocks/transport"
import { createApiClient, type ApiClient } from "./client"
import { httpTransport } from "./transport"

const USE_MOCKS = process.env.NEXT_PUBLIC_API_MOCKS === "true"

/** The only way components should reach the backend. */
export function useApi(): ApiClient {
  const { getToken } = useAuth()
  return useMemo(
    () => createApiClient(USE_MOCKS ? mockTransport : httpTransport(() => getToken())),
    [getToken]
  )
}
