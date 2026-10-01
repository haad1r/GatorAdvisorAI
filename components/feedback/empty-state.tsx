export function EmptyState({
    title,
    description,
}: {
    title: string,
    description: string,
}) {
    return (
        <section className="rounded-lg border border-border px-2.5 py-2">
            <h2 className="text-sm font-medium">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
        </section>
    )
}