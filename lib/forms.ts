/**
 * Shared form state contract.
 *
 * Every form (client-validated or backed by a server action via
 * `useActionState`) returns this shape so error display is consistent:
 *   - `fieldErrors` → shown under each field by <FormField>
 *   - `message`     → shown in <FormErrorSummary> (error) or a success note
 */
export type FieldErrors = Partial<Record<string, string[]>>

export type FormState = {
  status: "idle" | "success" | "error"
  message?: string
  fieldErrors?: FieldErrors
  /**
   * Changes on every submit attempt. FormErrorSummary only takes focus when
   * this changes, so clearing one field's error while the user types
   * doesn't steal focus. `errorState()` sets it for you.
   */
  submittedAt?: number
}

export const initialFormState: FormState = { status: "idle" }

/** First error for a field, or undefined. */
export function fieldError(
  state: FormState | undefined,
  name: string
): string | undefined {
  return state?.fieldErrors?.[name]?.[0]
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some((list) => (list?.length ?? 0) > 0)
}

/** Build an error FormState from field errors with a standard summary line. */
export function errorState(
  fieldErrors: FieldErrors,
  message = "Please fix the highlighted fields."
): FormState {
  return { status: "error", message, fieldErrors, submittedAt: Date.now() }
}

/** Stable DOM ids so labels, hints and errors are wired up the same way everywhere. */
export function fieldIds(id: string) {
  return {
    control: id,
    description: `${id}-description`,
    error: `${id}-error`,
  }
}