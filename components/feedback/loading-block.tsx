import { Skeleton } from "@/components/ui/skeleton";

export function LoadingBlock() {
    return (
        <div className="space-y-2" aria-busy="true" aria-label="Loading...">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
        </div>
    )
}