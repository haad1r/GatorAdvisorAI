"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const COURSES = ["COP3502", "MAC2311", "ENC1101"]

export function DialogDemo() {
  const [courses, setCourses] = React.useState(COURSES)
  const [removed, setRemoved] = React.useState<string | null>(null)
  const headingRef = React.useRef<HTMLHeadingElement>(null)
  const removing = React.useRef(false)

  function remove(code: string) {
    removing.current = true
    setCourses((list) => list.filter((c) => c !== code))
    setRemoved(code)
  }

  /* Cancel/Escape return focus to the trigger. After Remove the trigger is gone, so focus the heading. */
  function finalFocus() {
    const wasRemoved = removing.current
    removing.current = false
    return wasRemoved ? headingRef.current : true
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 ref={headingRef} tabIndex={-1} className="text-sm font-medium outline-none">Dialog</h2>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {courses.map((code) => (
          <li key={code} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            {code}
            <Dialog>
              <DialogTrigger render={<Button size="sm" variant="outline" />}>
                Remove<span className="sr-only"> {code}</span>
              </DialogTrigger>
              <DialogContent finalFocus={finalFocus}>
                <DialogHeader>
                  <DialogTitle>Remove {code}?</DialogTitle>
                  <DialogDescription>
                    <span className="block">It will no longer count toward your audit.</span>
                    <span className="block">You can add it back later.</span>
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                  <DialogClose render={<Button variant="destructive" />} onClick={() => remove(code)}>
                    Remove
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {removed ? `Removed ${removed}.` : ""}
      </p>
      {courses.length < COURSES.length && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => {
            setCourses(COURSES)
            setRemoved(null)
          }}
        >
          Reset list
        </Button>
      )}
    </section>
  )
}
