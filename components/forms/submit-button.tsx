"use client"

import * as React from "react"
import { useFormStatus } from "react-dom"
import { Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Submit button that disables itself and shows a spinner while the
 * enclosing <form action={…}> is pending. Pass `pending` explicitly when
 * the form is driven by local state instead of a form action.
 */
export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  pending: pendingProp,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "type"> & {
  pendingLabel?: string
  pending?: boolean
}) {
  const { pending: formPending } = useFormStatus()
  const pending = pendingProp ?? formPending

  return (
    <Button type="submit" disabled={pending} aria-disabled={pending} {...props}>
      {pending ? (
        <>
          <Loader2Icon aria-hidden="true" className="animate-spin" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  )
}