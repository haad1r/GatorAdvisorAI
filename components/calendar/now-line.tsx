"use client"

import * as React from "react"

/* Current minute of the day in Gainesville. Same time zone rule as the rest of the schedule. */
const CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
})

function gainesvilleMinutes() {
  const parts = CLOCK.formatToParts(new Date())
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return part("hour") * 60 + part("minute")
}

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 30_000)
  return () => clearInterval(id)
}

/**
 * Orange "now" line for today's column in the week grid. Decorative: the day
 * already says "today" to screen readers. Renders nothing on the server and
 * outside the grid's hours, so it can't cause a hydration mismatch.
 */
export function NowLine({ startHour, endHour }: { startHour: number; endHour: number }) {
  const minutes = React.useSyncExternalStore(subscribe, gainesvilleMinutes, () => null)
  if (minutes == null) return null
  const start = startHour * 60
  const end = endHour * 60
  if (minutes < start || minutes > end) return null
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 z-[1] h-0.5 bg-primary"
      style={{ top: `${((minutes - start) / (end - start)) * 100}%` }}
    >
      <span className="absolute -top-[3px] -left-1 size-2 rounded-full bg-primary" />
    </div>
  )
}
