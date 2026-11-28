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
        <section className={cn("rounded-lg bg-muted", lg ? "rounded-xl px-6 py-5" : "px-4 py-3")}>
            <h2 className={cn("font-semibold", lg ? "text-lg tracking-tight" : "text-sm")}>{title}</h2>
            <p className={cn("text-muted-foreground", lg ? "mt-1 text-[15px] lg:text-base" : "text-sm")}>{description}</p>
        </section>
    )
}
