import { Skeleton } from "@/components/ui/skeleton";

export function LoadingBlock() {
    return (
        <div role="status" aria-busy="true" className="space-y-2">
            <span className="sr-only">Loading…</span>
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
        </div>
    )
}
