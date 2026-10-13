import * as React from "react"
import { cn } from "cn"
import { Label } from "../ui/label"
import { fieldIds } from "../../lib/forms"

/** Props a FormField hands to its control so a11y wiring is never forgotten. */
export type FieldControlProps = {
  id: string
  name: string
  required?: boolean
  "aria-invalid"?: true
  "aria-describedby"?: string
}

/**
 * Label + control + hint + error, wired together:
 *   - <label for> points at the control
 *   - aria-describedby lists the hint and error
 *   - aria-invalid is set when there's an error
 *
 * Usage:
 *   <FormField id="major" label="Major" error={fieldError(state, "major")}>
 *     {(p) => <NativeSelect {...p}>…</NativeSelect>}
 *   </FormField>
 */
export function FormField({
  id,
  name = id,
  label,
  description,
  error,
  required,
  className,
  children,
}: {
  id: string
  name?: string
  label: string
  description?: string
  error?: string
  required?: boolean
  className?: string
  children: (control: FieldControlProps) => React.ReactNode
}) {
  const ids = fieldIds(id)
  const describedBy =
    [description && ids.description, error && ids.error]
      .filter(Boolean)
      .join(" ") || undefined

  return (
    <div
      data-slot="form-field"
      data-invalid={error ? "" : undefined}
      className={cn("flex flex-col gap-1.5", className)}
    >
      <Label htmlFor={ids.control}>
        {label}
        {required ? (
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        ) : null}
      </Label>
      {children({
        id: ids.control,
        name,
        required,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {description ? (
        <p id={ids.description} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={ids.error} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}