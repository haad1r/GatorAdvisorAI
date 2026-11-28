"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useApi } from "@/lib/api/use-api"

export function ProfileGate() {
    const api = useApi()
    const router = useRouter()

    React.useEffect(() => {
        api.getProfile().then((result) => {
            if (!result.ok && result.error.code === "NOT_FOUND") router.replace("/onboarding")
        })
    }, [api, router])

    return null
}

