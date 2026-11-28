import * as React from "react"
import { cn } from "cn"

/* Shared by the audit and dashboard summaries. Values come from the API, already computed. */

/**
 * Thin progress bar: earned in ink, optional in-progress share in orange.
 * `inProgress` is a 0-100 share of the whole bar, shown after the earned part.
 * Set `showLabel` to false when a bigger number nearby already says the same thing.
 */
export function ProgressBar({
  percent,
  label,
  inProgress = 0,
  showLabel = true,
  className,
}: {
  percent: number
  label: string
  inProgress?: number
  showLabel?: boolean
  className?: string
}) {
  const id = React.useId()
  const earned = clamp(percent)
  const pending = Math.min(clamp(inProgress), 100 - earned)
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className={cn("flex items-baseline justify-between text-sm", !showLabel && "sr-only")}>
        <span id={id}>{label}</span>
        <span className="font-medium">{percent}% complete</span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={id}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${percent}% complete`}
        className="flex h-1.5 overflow-hidden rounded-full bg-track"
      >
        <div className="h-full bg-track-done" style={{ width: `${earned}%` }} />
        {pending > 0 && <div className="h-full bg-primary" style={{ width: `${pending}%` }} />}
      </div>
    </div>
  )
}

function clamp(n: number) {
  return Math.min(100, Math.max(0, n))
}

export function Stat({ term, value, note }: { term: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="text-2xl font-semibold tracking-tight">{value}</dd>
      {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
    </div>
  )
}
