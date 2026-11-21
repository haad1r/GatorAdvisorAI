import type { Profile } from "@/lib/api/types"

/* Lets the app shell's top bar follow a profile saved or deleted elsewhere on the page. */
const EVENT = "gatoradvisor:profile"

export function announceProfile(profile: Profile | null) {
  window.dispatchEvent(new CustomEvent<Profile | null>(EVENT, { detail: profile }))
}

export function onProfileChange(listener: (profile: Profile | null) => void) {
  const handle = (e: Event) => listener((e as CustomEvent<Profile | null>).detail)
  window.addEventListener(EVENT, handle)
  return () => window.removeEventListener(EVENT, handle)
}
