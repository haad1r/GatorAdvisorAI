import Link from "next/link"

type PreviewKind = "board" | "table" | "chat" | "list"

/**
 * Placeholder for a page whose API doesn't exist yet. A faded outline of the
 * page's layout (shapes only: no text, numbers or course codes, so it can't be
 * mistaken for data), then what the page will do, and a link to something
 * that works today. The outline is hidden from screen readers.
 */
export function ComingSoon({
  id,
  title,
  description,
  preview,
  link,
}: {
  id: string
  title: string
  description: string
  preview: PreviewKind
  link?: { href: string; label: string }
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col overflow-hidden rounded-2xl bg-muted/60">
      <div
        aria-hidden="true"
        className="pointer-events-none h-56 overflow-hidden px-6 pt-6 select-none [mask-image:linear-gradient(to_bottom,black_35%,transparent)] sm:h-64 lg:px-8 lg:pt-8"
      >
        <Preview kind={preview} />
      </div>
      <div className="flex flex-col items-start gap-2 px-6 pb-7 lg:px-8 lg:pb-8">
        <h2 id={id} className="text-xl font-semibold tracking-tight">
          {title}
        </h2>
        <p className="max-w-[60ch] text-[15px] text-muted-foreground">{description}</p>
        {link && (
          <Link
            href={link.href}
            className="mt-2 rounded-sm text-sm font-semibold text-brand-orange-text underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {link.label}
          </Link>
        )}
      </div>
    </section>
  )
}

/* Fixed widths, never random: the server and the browser must render the same thing. */
const WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-5/6", "w-2/5", "w-3/5"]

function Bar({ className }: { className: string }) {
  return <span className={`block h-2.5 rounded-full bg-track ${className}`} />
}

function Preview({ kind }: { kind: PreviewKind }) {
  if (kind === "board") {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[4, 5, 4, 3].map((cards, col) => (
          <div key={col} className={col > 1 ? "hidden flex-col gap-2 sm:flex" : "flex flex-col gap-2"}>
            <Bar className="mb-1 w-1/2" />
            {Array.from({ length: cards }, (_, i) => (
              <span key={i} className="flex flex-col gap-2 rounded-lg bg-background p-3 shadow-[0_1px_2px_rgba(14,21,37,0.05)]">
                <Bar className="w-1/2 bg-track-done/15" />
                <Bar className={WIDTHS[(i + col) % WIDTHS.length]} />
              </span>
            ))}
          </div>
        ))}
      </div>
    )
  }
  if (kind === "table") {
    return (
      <div className="flex flex-col">
        <span className="mb-3 block h-10 rounded-full bg-background shadow-[0_1px_2px_rgba(14,21,37,0.05)]" />
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="grid grid-cols-[5rem_minmax(0,1fr)_3rem] items-center gap-4 border-b border-border py-3.5 sm:grid-cols-[6rem_minmax(0,1fr)_4rem_8rem]">
            <Bar className="w-full bg-track-done/15" />
            <Bar className={WIDTHS[i % WIDTHS.length]} />
            <Bar className="w-2/3" />
            <span className="hidden h-5 w-20 rounded-full bg-track sm:block" />
          </span>
        ))}
      </div>
    )
  }
  if (kind === "chat") {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <span className="ml-auto block h-11 w-2/3 rounded-2xl rounded-br-md bg-background shadow-[0_1px_2px_rgba(14,21,37,0.05)] sm:w-1/2" />
        <span className="flex flex-col gap-2.5">
          <Bar className="w-11/12" />
          <Bar className="w-4/5" />
          <Bar className="w-2/3" />
        </span>
        {[0, 1, 2].map((i) => (
          <span key={i} className="flex items-center gap-3 border-b border-border pb-3">
            <span className="size-4 shrink-0 rounded-full bg-track" />
            <Bar className={WIDTHS[i + 1]} />
          </span>
        ))}
      </div>
    )
  }
  return (
    <div className="flex flex-col">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className="flex items-center gap-4 border-b border-border py-4">
          <span className="size-9 shrink-0 rounded-lg bg-background shadow-[0_1px_2px_rgba(14,21,37,0.05)]" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <Bar className={WIDTHS[i % WIDTHS.length]} />
            <Bar className="w-1/3 bg-track-done/15" />
          </span>
          <span className="hidden h-5 w-24 rounded-full bg-track sm:block" />
        </span>
      ))}
    </div>
  )
}
