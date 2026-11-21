"use client"

import * as React from "react"
import { MenuIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { SidebarContent } from "./sidebar-content"

/* The desktop sidebar, as a left-hand panel on the shared dialog (focus trap, Escape, focus return). */
export function MobileMenu() {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="icon" className="size-10" aria-label="Open menu" />}>
        <MenuIcon aria-hidden="true" className="size-5" />
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 flex h-dvh w-64 max-w-[85vw] translate-x-0 translate-y-0 flex-col gap-6 rounded-none bg-background px-4 py-5 ring-0 border-r border-border sm:max-w-[85vw] data-open:slide-in-from-left data-open:zoom-in-100 data-closed:slide-out-to-left data-closed:zoom-out-100"
      >
        <DialogTitle className="sr-only">Menu</DialogTitle>
        <SidebarContent onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
