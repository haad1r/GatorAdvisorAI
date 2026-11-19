"use client"

import * as React from "react"
import { useApi } from "@/lib/api/use-api"
import type { Profile } from "@/lib/api/types"
import { PLACEHOLDER_MAJOR_OPTIONS } from "@/lib/onboarding"
import { onProfileChange } from "@/lib/profile-events"

/** "Computer Science · 2025-2026 catalog". Renders nothing until the profile loads, or if it fails. */
export function ProgramSummary({ className }: { className?: string }) {
  const api = useApi()
  const [profile, setProfile] = React.useState<Profile | null>(null)

  React.useEffect(() => {
    let live = true
    api.getProfile().then((result) => {
      if (live && result.ok) setProfile(result.data)
    })
    const stop = onProfileChange((p) => {
      live = false
      setProfile(p)
    })
    return () => {
      live = false
      stop()
    }
  }, [api])

  if (!profile) return null
  const major = PLACEHOLDER_MAJOR_OPTIONS.find((o) => o.value === profile.major)?.label ?? profile.major
  return (
    <p className={className}>
      {major} · {profile.catalogYear} catalog
    </p>
  )
}
