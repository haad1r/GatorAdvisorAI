import { Badge } from "@/components/ui/badge"

type status = "idle" | "loading" | "success" | "error"

const variantFor: Record <
    status,
    "default" | "destructive" | "outline" | "secondary" 
> = {
    idle: "secondary",
    loading: "outline",
    success: "default",
    error: "destructive",
};

export function StatusBadge({ kind, label }:
    { kind: status, label: string }
) {
    return <Badge variant={variantFor[kind]}>{label}</Badge>;
}