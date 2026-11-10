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

/** Current theme plus a toggle that saves the choice. Shared by every theme control. */
export function useTheme() {
  const dark = React.useSyncExternalStore(subscribe, isDark, () => false)

  function toggle() {
    const next = isDark() ? "light" : "dark"
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {}
    const root = document.documentElement
    root.classList.toggle("dark", next === "dark")
    root.style.colorScheme = next
  }

  return { dark, toggle }
}

export function ThemeToggle({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  const { dark, toggle } = useTheme()
  const label = dark ? "Switch to light theme" : "Switch to dark theme"

  return (
    <Button variant="outline" size="icon" className={cn(className)} onClick={toggle} aria-label={label} title={label}>
      {dark ? <SunIcon aria-hidden="true" className={iconClassName} /> : <MoonIcon aria-hidden="true" className={iconClassName} />}
    </Button>
  )
}
