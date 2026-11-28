import { ExternalLinkIcon, StarIcon } from "lucide-react"
import type { Instructor } from "@/lib/api/types"

/** NEXT_PUBLIC_SHOW_RMP=false hides every RateMyProfessors number and link. */
export const SHOW_RMP = process.env.NEXT_PUBLIC_SHOW_RMP !== "false"

const RMP = "https://www.ratemyprofessors.com"
const UF_SCHOOL_ID = 1100

/**
 * An instructor's name with their RateMyProfessors summary: numbers only,
 * always credited to RMP, always linking to the full reviews there.
 */
export function InstructorRating({ instructor }: { instructor: Instructor }) {
  const { name, rating } = instructor
  if (!SHOW_RMP) return <p className="font-medium">{name}</p>

  if (!rating) {
    return (
      <div className="flex flex-col gap-0.5">
        <p className="font-medium">{name}</p>
        <p className="text-muted-foreground">No RateMyProfessors match.</p>
        <RmpLink href={`${RMP}/search/professors/${UF_SCHOOL_ID}?q=${encodeURIComponent(name)}`} label="Search RateMyProfessors" name={name} />
      </div>
    )
  }

  const stats = [
    rating.quality != null && (
      <span key="q" className="inline-flex items-center gap-1 font-medium">
        <StarIcon aria-hidden="true" className="size-3.5" />
        {rating.quality.toFixed(1)}
        <span className="font-normal text-muted-foreground">quality</span>
      </span>
    ),
    rating.difficulty != null && <span key="d">{rating.difficulty.toFixed(1)} difficulty</span>,
    rating.wouldTakeAgainPercent != null && <span key="w">{Math.round(rating.wouldTakeAgainPercent)}% would take again</span>,
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-0.5">
      <p className="font-medium">{name}</p>
      {stats.length > 0 && <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">{stats}</p>}
      <p className="text-muted-foreground">
        {rating.numRatings} {rating.numRatings === 1 ? "rating" : "ratings"} on RateMyProfessors
        {rating.numRatings < 5 ? " (too few to rely on)" : ""}
      </p>
      <RmpLink href={`${RMP}/professor/${rating.rmpId}`} label="Read reviews on RateMyProfessors" name={name} />
    </div>
  )
}

function RmpLink({ href, label, name }: { href: string; label: string; name: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 self-start text-brand-blue underline underline-offset-4">
      {label}
      <span className="sr-only"> for {name} (opens in a new tab)</span>
      <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
    </a>
  )
}
