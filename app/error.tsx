"use client" // Error boundaries must be Client Components

import { RouteError } from "@/components/feedback/route-error"

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return <RouteError error={error} retry={retry} />
}
