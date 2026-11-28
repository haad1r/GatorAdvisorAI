"use client"

import * as React from "react"
import Link from "next/link"
import { CheckIcon } from "lucide-react"
import { Button } from "../ui/button"
import { LoadFailed } from "../feedback/load-failed"
import { LoadingBlock } from "../feedback/loading-block"
import { useApi } from "../../lib/api/use-api"
import { useLoad } from "../../lib/api/use-load"
import type { ApiResult, Profile, SurveySubmission } from "../../lib/api/types"
import { SurveyForm } from "./survey-form"

type Loaded = { profile: Profile; last: SurveySubmission | null }

/** /settings/survey: take or retake the survey, pre-filled from the latest submission. */
export function SurveyRetake() {
  const api = useApi()
  const fetcher = React.useCallback(async (): Promise<ApiResult<Loaded>> => {
    const [profile, last] = await Promise.all([api.getProfile(), api.getLatestSurvey()])
    if (!profile.ok) return profile
    if (!last.ok) return last
    return { ok: true, data: { profile: profile.data, last: last.data } }
  }, [api])
  const { state, retry } = useLoad<Loaded>(fetcher)
  const [saved, setSaved] = React.useState(false)
  const savedRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (saved) savedRef.current?.focus()
  }, [saved])

  return (
    <div
      className="flex max-w-2xl flex-col gap-4 rounded-xl border border-border bg-card px-5 py-4 lg:px-6 lg:py-5"
    >
      {state.kind === "loading" && <LoadingBlock />}
      {state.kind === "error" && <LoadFailed error={state.error} onRetry={retry} />}
      {state.kind === "ok" && saved ? (
        <div ref={savedRef} tabIndex={-1} role="status" className="flex flex-col items-start gap-3 outline-none">
          <div className="flex items-center gap-2">
            <CheckIcon aria-hidden="true" className="size-5 text-primary" />
            <h2 id="survey-title" className="text-base font-semibold lg:text-lg">
              Survey saved
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">Your recommendations will use these answers from now on.</p>
          <Button variant="outline" render={<Link href="/settings" />} nativeButton={false}>
            Back to Settings
          </Button>
        </div>
      ) : null}
      {state.kind === "ok" && !saved ? (
        <SurveyForm
          major={state.data.profile.major}
          last={state.data.last}
          header={
            <h2 id="survey-title" className="text-base font-semibold lg:text-lg">
              {state.data.last ? "Retake the interest survey" : "Take the interest survey"}
            </h2>
          }
          secondaryAction={
            <Button variant="outline" render={<Link href="/settings" />} nativeButton={false}>
              Cancel
            </Button>
          }
          onSaved={() => setSaved(true)}
        />
      ) : null}
    </div>
  )
}
