import type { ApiErrorCode } from "@/lib/api/types"
import type { FieldErrors } from "@/lib/forms"

/* The client turns these back into ApiError (lib/api/transport.ts). */
const STATUS: Record<Exclude<ApiErrorCode, "NETWORK">, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  STALE_WRITE: 409,
  QUOTA_EXCEEDED: 429,
  SERVER: 500,
}

export function ok<T>(data: T, status = 200) {
  return Response.json(data, { status })
}

export function fail(code: keyof typeof STATUS, message: string, fieldErrors?: FieldErrors) {
  return Response.json({ error: { code, message, fieldErrors } }, { status: STATUS[code] })
}
