import { cn } from "cn"

export function EmptyState({
    title,
    description,
    size = "default",
}: {
    title: string,
    description: string,
    size?: "default" | "lg",
}) {
    const lg = size === "lg"
    return (
        <section className={cn("rounded-lg border border-border bg-card", lg ? "rounded-xl px-5 py-4 lg:px-6 lg:py-5" : "px-2.5 py-2")}>
            <h2 className={cn("font-medium", lg ? "text-base lg:text-lg" : "text-sm")}>{title}</h2>
            <p className={cn("text-muted-foreground", lg ? "mt-1 text-[15px] lg:text-base" : "text-sm")}>{description}</p>
        </section>
    )
}
