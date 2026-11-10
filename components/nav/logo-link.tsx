import Image from "next/image"
import Link from "next/link"
import { cn } from "cn"

export function LogoLink({ className }: { className?: string }) {
  return (
    <Link
      href="/dashboard"
      aria-label="GatorAdvisor home"
      className={cn("inline-flex shrink-0 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}
    >
      <Image src="/logo-mark.png" alt="" width={172} height={40} priority className="dark:hidden" />
      <Image src="/logo-mark-dark.png" alt="" width={172} height={40} priority className="hidden dark:block" />
    </Link>
  )
}
