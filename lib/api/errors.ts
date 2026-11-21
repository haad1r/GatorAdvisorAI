import { errorState, type FormState } from "@/lib/forms"
import type { ApiError, ApiErrorCode } from "./types"

/** For forms: field errors go under each field, everything else in the summary. */
export function toFormState(error: ApiError): FormState {
  if (error.code === "VALIDATION_ERROR" && error.fieldErrors) {
    return errorState(error.fieldErrors, error.message)
  }
  return { status: "error", message: toErrorPanel(error).description, submittedAt: Date.now() }
}

const PANEL: Record<ApiErrorCode, (e: ApiError) => { title: string; description: string }> = {
  UNAUTHENTICATED: () => ({ title: "Your session expired", description: "Sign in again to continue." }),
  FORBIDDEN: () => ({ title: "You don't have access", description: "This belongs to another account, or you aren't allowed to change it." }),
  NOT_FOUND: () => ({ title: "Not found", description: "We couldn't find what you were looking for." }),
  VALIDATION_ERROR: (e) => ({ title: "Some details need fixing", description: e.message }),
  STALE_WRITE: () => ({ title: "This changed somewhere else", description: "Reload to see the latest version before saving again." }),
  QUOTA_EXCEEDED: (e) => ({
    title: "Too many requests",
    description: e.retryAfterSeconds ? `Try again in ${e.retryAfterSeconds} seconds.` : "Try again in a moment.",
  }),
  SERVER: () => ({ title: "Something went wrong on our side", description: "Try again in a moment." }),
  NETWORK: () => ({ title: "You're offline", description: "Check your connection and try again." }),
}

/** Props for <ErrorPanel>. */
export function toErrorPanel(error: ApiError) {
  return PANEL[error.code](error)
}
