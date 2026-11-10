import type { ApiError, ApiErrorCode, Transport } from "./types"

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "STALE_WRITE",
  422: "VALIDATION_ERROR",
  429: "QUOTA_EXCEEDED",
}

async function toApiError(res: Response): Promise<ApiError> {
  const json = await res.json().catch(() => null)
  const sent: Partial<ApiError> = json?.error ?? {}
  const retryAfter = Number(res.headers.get("Retry-After"))
  return {
    code: sent.code ?? CODE_BY_STATUS[res.status] ?? "SERVER",
    message: sent.message ?? "Something went wrong.",
    fieldErrors: sent.fieldErrors,
    retryAfterSeconds: sent.retryAfterSeconds ?? (retryAfter || undefined),
  }
}

/** The real backend. getToken comes from Clerk's useAuth(). */
export function httpTransport(getToken: () => Promise<string | null>): Transport {
  return async ({ method, path, body }) => {
    let res: Response
    try {
      const token = await getToken()
      res = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      return { ok: false, error: { code: "NETWORK", message: "You appear to be offline." } }
    }

    if (!res.ok) return { ok: false, error: await toApiError(res) }
    return { ok: true, data: await res.json().catch(() => null) }
  }
}
