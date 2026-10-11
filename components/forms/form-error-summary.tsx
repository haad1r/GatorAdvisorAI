"use client"

import * as React from "react"
import { CircleAlertIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { FormState } from "@/lib/forms"

/**
 * Form-level error box. Shown at the top of a form after a failed submit.
 * Moves focus to itself so keyboard and screen-reader users land on the
 * problem, and links each field error to its field.
 *
 * `labels` maps field names to readable labels; fields without a label are
 * still counted but not linked.
 */
export function FormErrorSummary({
  state,
  labels = {},
  title = "Something needs your attention",
}: {
  state: FormState
  labels?: Record<string, string>
  title?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const isError = state.status === "error"
  // Focus once per submit attempt (see FormState.submittedAt), not on every
  // state change, or editing a field would pull focus away from it.
  const attempt = state.submittedAt ?? state.message

  React.useEffect(() => {
    if (isError) ref.current?.focus()
  }, [isError, attempt])

  if (!isError) return null

  const linked = Object.entries(state.fieldErrors ?? {}).filter(
    ([name, errs]) => labels[name] && errs?.length
  )

  return (
    <div ref={ref} tabIndex={-1} className="outline-none">
      <Alert variant="destructive">
        <CircleAlertIcon aria-hidden="true" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          {state.message ? <p>{state.message}</p> : null}
          {linked.length > 0 ? (
            <ul className="list-disc pl-4">
              {linked.map(([name, errs]) => (
                <li key={name}>
                  <a href={`#${name}`}>
                    {labels[name]}: {errs![0]}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </AlertDescription>
      </Alert>
    </div>
  )
}
