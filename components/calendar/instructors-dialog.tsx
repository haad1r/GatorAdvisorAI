"use client"

import { UsersIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { InstructorRating, SHOW_RMP } from "@/components/ratings/instructor-rating"
import type { ScheduleMeeting } from "@/lib/api/types"
import { formatCourseCode } from "@/lib/format"

/** One row per section in this week's schedule, with who teaches it. */
export function InstructorsDialog({ meetings }: { meetings: ScheduleMeeting[] }) {
  const sections = new Map<string, ScheduleMeeting>()
  for (const m of meetings) {
    const key = `${m.courseCode}-${m.section}`
    if (!sections.has(key)) sections.set(key, m)
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" className="h-10 gap-2 px-4 text-[15px]" />}>
        <UsersIcon aria-hidden="true" />
        Instructors
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Your instructors</DialogTitle>
          <DialogDescription>
            {SHOW_RMP
              ? "Ratings are summaries from RateMyProfessors, written by past students. They describe the professor, not this exact class."
              : "Who teaches each class on your schedule."}
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col divide-y divide-border text-sm">
          {[...sections.values()].map((m) => (
            <li key={`${m.courseCode}-${m.section}`} className="flex flex-col gap-2 py-3">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">{formatCourseCode(m.courseCode)}</span>
                <span className="text-muted-foreground">{m.title}</span>
              </p>
              {m.instructors.length === 0 ? (
                <p className="text-muted-foreground">Instructor not announced yet.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {m.instructors.map((i) => (
                    <li key={i.name}>
                      <InstructorRating instructor={i} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
