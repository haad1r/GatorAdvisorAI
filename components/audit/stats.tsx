import * as React from "react"

/* Shared by the audit and dashboard summaries. Values come from the API, already computed. */

export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const id = React.useId()
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-sm">
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
        className="h-2.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    </div>
  )
}

export function Stat({ term, value, note }: { term: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="text-base font-semibold">{value}</dd>
      {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
    </div>
  )
}
