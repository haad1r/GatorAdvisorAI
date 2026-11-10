"use client"

import * as React from "react"

type FluidScaleProps = {
  children: React.ReactNode
  /** Column width (px) at which the content renders at 1x. */
  baseWidth?: number
  min?: number
  max?: number
  /** Cap for the stacked (mobile) layout, where the column is full width. */
  maxStacked?: number
}

/**
 * Scales its children as a whole (width, text, controls, spacing) in
 * proportion to the parent column's width, the same way AuthShell's headline
 * grows with the viewport. CSS `zoom` only takes a number, so the factor is
 * computed here rather than written as a clamp().
 *
 * The column is measured as a share of the page and applied to
 * window.innerWidth, which includes the scrollbar. Measuring the raw column
 * width caused a loop: zoom changed the page height, which toggled the
 * scrollbar, which changed the column width.
 *
 * Content stays invisible until the first measurement so it never paints at
 * the wrong size and then jumps.
 */
export function FluidScale({
  children,
  baseWidth = 540,
  min = 1,
  max = 1.55,
  maxStacked = 1.15,
}: FluidScaleProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = React.useState<number | null>(null)

  React.useLayoutEffect(() => {
    const column = ref.current?.parentElement
    if (!column) return

    function update() {
      if (!column) return
      const share = column.offsetWidth / document.documentElement.clientWidth
      const width = share * window.innerWidth
      const cap = share > 0.75 ? maxStacked : max
      const next = Math.min(cap, Math.max(min, width / baseWidth))
      setZoom(Math.round(next * 1000) / 1000)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(column)
    window.addEventListener("resize", update)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [baseWidth, min, max, maxStacked])

  return (
    <div
      ref={ref}
      className="flex w-full justify-center transition-opacity duration-150"
      style={{ zoom: zoom ?? 1, opacity: zoom === null ? 0 : 1 }}
    >
      {children}
    </div>
  )
}
