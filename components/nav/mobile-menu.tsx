"use client"

import * as React from "react"
import { MenuIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { AccountButton } from "./account-button"
import { LogoLink } from "./logo-link"
import { NavList } from "./nav-links"

/* Every page, in a left-hand panel built on the shared dialog (focus trap, Escape, focus return). */
export function MobileMenu() {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon" className="size-10 [&_svg]:size-5" aria-label="Open menu" />}>
        <MenuIcon aria-hidden="true" />
      </DialogTrigger>
      <DialogContent
        className="top-0 left-0 flex h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 flex-col gap-6 rounded-none rounded-r-2xl p-4 sm:max-w-[85vw] data-open:slide-in-from-left data-open:zoom-in-100 data-closed:slide-out-to-left data-closed:zoom-out-100"
      >
        <DialogTitle className="sr-only">Menu</DialogTitle>
        <LogoLink className="self-start" />
        <nav aria-label="Menu" className="flex-1 overflow-y-auto">
          <NavList list="all" onNavigate={() => setOpen(false)} />
        </nav>
        <AccountButton showName />
      </DialogContent>
    </Dialog>
  )
}
