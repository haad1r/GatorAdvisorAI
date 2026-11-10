import { cn } from "cn"
import type { MeetingKind, ScheduleMeeting } from "@/lib/api/types"
import { KIND_LABEL, formatTimeRange, meetingLabel } from "@/lib/schedule"

/* Kind is always shown as text; color only reinforces it. */
const KIND_STYLE: Record<MeetingKind, string> = {
  lecture: "border-l-brand-blue bg-brand-blue/10",
  discussion: "border-l-brand-blue/60 bg-brand-blue/5",
  lab: "border-l-event-lab bg-event-lab/10",
  exam: "border-l-brand-orange bg-brand-orange/15",
}

/**
 * One meeting. The visible text is short; screen readers get the full
 * sentence from meetingLabel() instead.
 */
export function CalendarEvent({
  meeting,
  compact = false,
  fixedHeight = false,
  className,
}: {
  meeting: ScheduleMeeting
  /** Grid cells: course, kind, and time only. */
  compact?: boolean
  /** Set by the grid, where blocks have a fixed height: short blocks switch to one line. */
  fixedHeight?: boolean
  className?: string
}) {
  const { time } = meeting
  return (
    <article
      aria-label={meetingLabel(meeting)}
      title={meetingLabel(meeting)}
      className={cn(
        "min-w-0 overflow-hidden rounded-md border-l-4 px-2 text-xs",
        compact ? "py-1" : "py-3",
        /* Size containment needs a set height, so only fixed-height grid blocks get it. */
        fixedHeight ? "[container-type:size]" : "@container",
        KIND_STYLE[meeting.kind],
        className
      )}
    >
      {/* Container queries style children, not the container, hence this wrapper.
          Grid blocks with under 2.95rem of space inside the padding (too little for two lines) put course and time on one line. Classes must be literal for Tailwind. */}
      <div
        aria-hidden="true"
        className={cn(
          "flex min-w-0 flex-col gap-2.5",
          fixedHeight &&
            "[@container(max-height:2.95rem)]:flex-row [@container(max-height:2.95rem)]:items-baseline [@container(max-height:2.95rem)]:gap-7"
        )}
      >
        <p className="flex shrink-0 items-baseline gap-1.5">
          <span className="shrink-0 font-semibold text-foreground">{meeting.courseCode}</span>
          {/* Narrow or short blocks drop the tag (screen readers still get it); exams always keep theirs. */}
          <span
            className={cn(
              "ml-auto hidden shrink-0 rounded px-1 text-[0.85em] font-medium @min-[8.5rem]:inline",
              meeting.kind === "exam"
                ? "bg-brand-orange text-primary-foreground"
                : "text-muted-foreground [@container(max-height:2.95rem)]:hidden"
            )}
          >
            {KIND_LABEL[meeting.kind]}
          </span>
        </p>
        <p className="min-w-0 truncate text-muted-foreground">
          {time ? formatTimeRange(time.start, time.end) : meeting.online ? "Online · no set time" : "Time TBA"}
        </p>
      </div>
      {!compact && !(meeting.online && !meeting.location) && (
        <p aria-hidden="true" className="truncate text-muted-foreground">
          {meeting.location ?? "Location TBA"}
        </p>
      )}
    </article>
  )
}
