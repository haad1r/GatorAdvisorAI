import type { Delivery, GenEdArea, Quest } from "@/lib/api/types"

export const GEN_ED_LABEL: Record<GenEdArea, string> = {
  composition: "Composition (C)",
  humanities: "Humanities (H)",
  social: "Social Sciences (S)",
  biological: "Biological Sciences (B)",
  physical: "Physical Sciences (P)",
  mathematics: "Mathematics (M)",
  international: "International (N)",
}

export const QUEST_LABEL: Record<Quest, string> = {
  quest1: "Quest 1",
  quest2: "Quest 2",
  quest3: "Quest 3",
}

/** UF SOC delivery codes. */
export const DELIVERY_LABEL: Record<Delivery, string> = {
  PC: "In person",
  HB: "Hybrid",
  PD: "Mostly online",
  AD: "Online",
}

export const LEVELS = [1000, 2000, 3000, 4000] as const

export const CREDIT_OPTIONS = [1, 2, 3, 4, 5] as const

export function formatCredits({ min, max }: { min: number; max: number }) {
  const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1))
  if (min === max) return `${n(min)} ${min === 1 ? "credit" : "credits"}`
  return `${n(min)}–${n(max)} credits`
}

export function formatSeasons(seasons: string[]) {
  const order = ["fall", "spring", "summer"]
  const names = order.filter((s) => seasons.includes(s)).map((s) => s[0].toUpperCase() + s.slice(1))
  return names.length ? names.join(", ") : null
}
