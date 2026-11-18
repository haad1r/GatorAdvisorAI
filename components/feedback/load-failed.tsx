import { Button } from "@/components/ui/button"
import { toErrorPanel } from "@/lib/api/errors"
import type { ApiError } from "@/lib/api/types"
import { ErrorPanel } from "./error-panel"

/** A failed load: the error message plus "Try again". */
export function LoadFailed({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <ErrorPanel {...toErrorPanel(error)} />
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
