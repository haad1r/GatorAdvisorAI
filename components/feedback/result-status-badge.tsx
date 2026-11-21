import { AlertTriangleIcon, CheckIcon, CircleDashedIcon, CircleIcon, HelpCircleIcon, type LucideIcon } from "lucide-react"
import { cn } from "cn"
import type { AuditStatus, TrackingStatus } from "@/lib/api/types"

export type ResultStatus = AuditStatus | TrackingStatus

/* Status is never color alone (#21): every badge has a label and an icon shape. */
const STYLE: Record<ResultStatus, { label: string; icon: LucideIcon; className: string }> = {
  met: { label: "Met", icon: CheckIcon, className: "bg-event-lab/15 border-event-lab/40" },
  in_progress: { label: "In progress", icon: CircleDashedIcon, className: "bg-brand-blue/10 border-brand-blue/40" },
  not_met: { label: "Not met", icon: CircleIcon, className: "border-border" },
  at_risk: { label: "At risk", icon: AlertTriangleIcon, className: "bg-brand-orange/20 border-brand-orange/60" },
  unknown: { label: "Unknown", icon: HelpCircleIcon, className: "bg-muted border-border border-dashed" },
}

export const RESULT_STATUS_LABEL = Object.fromEntries(
  Object.entries(STYLE).map(([k, v]) => [k, v.label])
) as Record<ResultStatus, string>

export function ResultStatusBadge({ status, className }: { status: ResultStatus; className?: string }) {
  const { label, icon: Icon, className: tone } = STYLE[status]
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap text-foreground",
        tone,
        className
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  )
}
