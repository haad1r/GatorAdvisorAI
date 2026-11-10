"use client"

import * as React from "react"
import { MoonIcon, SunIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { THEME_STORAGE_KEY } from "./theme-script"

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}

const isDark = () => document.documentElement.classList.contains("dark")

export function ThemeToggle({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  const dark = React.useSyncExternalStore(subscribe, isDark, () => false)
  const label = dark ? "Switch to light theme" : "Switch to dark theme"

  function toggle() {
    const next = dark ? "light" : "dark"
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {}
    const root = document.documentElement
    root.classList.toggle("dark", next === "dark")
    root.style.colorScheme = next
  }

  return (
    <Button variant="outline" size="icon" className={cn(className)} onClick={toggle} aria-label={label} title={label}>
      {dark ? <SunIcon aria-hidden="true" className={iconClassName} /> : <MoonIcon aria-hidden="true" className={iconClassName} />}
    </Button>
  )
}
