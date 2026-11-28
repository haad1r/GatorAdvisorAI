"use client"

import * as React from "react"
import Link from "next/link"
import { useAuth, useClerk } from "@clerk/nextjs"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ErrorPanel } from "@/components/feedback/error-panel"
import { LoadFailed } from "@/components/feedback/load-failed"
import { LoadingBlock } from "@/components/feedback/loading-block"
import { FormErrorSummary } from "@/components/forms/form-error-summary"
import { FormField } from "@/components/forms/form-field"
import { SubmitButton } from "@/components/forms/submit-button"
import { useTheme } from "@/components/theme/theme-toggle"
import { toErrorPanel, toFormState } from "@/lib/api/errors"
import type { ApiError, Coursework, Profile, SurveySubmission } from "@/lib/api/types"
import { useLoad } from "@/lib/api/use-load"
import { useApi } from "@/lib/api/use-api"
import { errorState, fieldError, hasErrors, initialFormState, type FormState } from "@/lib/forms"
import {
  CLASS_STANDING_OPTIONS,
  PLACEHOLDER_CATALOG_YEARS,
  PLACEHOLDER_ENTRY_TERMS,
  PLACEHOLDER_GRAD_TERMS,
  PLACEHOLDER_MAJOR_OPTIONS,
  PROFILE_LABELS,
  errorsAfterChange,
  validateProfile,
  type OnboardingProfile,
  type Option,
} from "@/lib/onboarding"
import { announceProfile } from "@/lib/profile-events"

/* Settings (#21): profile and program, survey, courses, theme, delete account. */
export function SettingsView({ deleted: deletedParam = false }: { deleted?: boolean }) {
  const { signOut } = useClerk()
  const { isLoaded, isSignedIn } = useAuth()
  const [justDeleted, setJustDeleted] = React.useState(false)
  // ?account=deleted is where the sign-out lands. It only counts once the session is gone:
  // a signed-in student who opens that link gets Settings as usual.
  const deleted = justDeleted || (deletedParam && isLoaded && !isSignedIn)

  function onDeleted() {
    setJustDeleted(true)
    announceProfile(null)
    // The account is gone, so its session must end too. The redirect lands back here with the message.
    signOut({ redirectUrl: "/settings?account=deleted" }).catch(() => {})
  }

  if (deletedParam && !isLoaded) return <LoadingBlock />

  if (deleted) {
    return (
      <section role="status" className="max-w-2xl rounded-xl bg-muted px-6 py-5">
        <h2 className="text-lg font-semibold tracking-tight">Your account was deleted</h2>
        <p className="mt-1 text-muted-foreground">
          Your profile, courses, survey answers, plans, schedules, and chats are gone, and you&apos;ve been signed out.
        </p>
      </section>
    )
  }

  return (
    <div className="flex max-w-4xl flex-col">
      <ProfileSection />
      <SurveySection />
      <CoursesSection />
      <AppearanceSection />
      <DeleteAccountSection onDeleted={onDeleted} />
    </div>
  )
}

/* ---------- shared bits ---------- */

function Section({
  id,
  title,
  description,
  danger = false,
  children,
}: {
  id: string
  title: string
  description?: string
  /** Red heading, to set the destructive action apart. */
  danger?: boolean
  children: React.ReactNode
}) {
  /* No cards: sections are separated by a hairline, with the title on the left on desktop. */
  return (
    <section
      aria-labelledby={id}
      className="grid gap-5 border-t border-border py-8 first:border-t-0 first:pt-0 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12"
    >
      <div>
        <h2 id={id} className={cn("text-lg font-semibold tracking-tight", danger && "text-destructive")}>
          {title}
        </h2>
        {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  )
}

/* ---------- profile and program ---------- */

function ProfileSection() {
  const api = useApi()
  const fetcher = React.useCallback(() => api.getProfile(), [api])
  const { state, retry } = useLoad(fetcher)

  return (
    <Section id="settings-profile" title="Profile and program" description="Your program and catalog year decide which requirements apply to you.">
      {state.kind === "loading" && <LoadingBlock />}
      {state.kind === "error" && <LoadFailed error={state.error} onRetry={retry} />}
      {state.kind === "ok" && <ProfileForm initial={state.data} />}
    </Section>
  )
}

function ProfileForm({ initial }: { initial: Profile }) {
  const api = useApi()
  const [profile, setProfile] = React.useState<OnboardingProfile>(initial)
  const [state, setState] = React.useState<FormState>(initialFormState)
  const [pending, setPending] = React.useState(false)

  function update(field: keyof OnboardingProfile, value: string) {
    setProfile((p) => ({ ...p, [field]: value }))
    setState((s) => (s.status === "success" ? initialFormState : { ...s, fieldErrors: errorsAfterChange(s.fieldErrors, field) }))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const errors = validateProfile(profile)
    if (hasErrors(errors)) return setState(errorState(errors))
    setPending(true)
    const result = await api.saveProfile(profile)
    setPending(false)
    if (result.ok) announceProfile(result.data)
    setState(result.ok ? { status: "success", message: "Profile saved." } : toFormState(result.error))
  }

  const select = (field: keyof OnboardingProfile, options: Option[], description?: string) => (
    <FormField id={field} label={PROFILE_LABELS[field]} description={description} error={fieldError(state, field)} required>
      {(p) => (
        <NativeSelect {...p} value={profile[field]} onChange={(e) => update(field, e.target.value)}>
          <option value="" disabled>
            Select…
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-6">
      <FormErrorSummary state={state} labels={PROFILE_LABELS} />
      <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
        <FormField id="preferredName" label={PROFILE_LABELS.preferredName} error={fieldError(state, "preferredName")} required>
          {(p) => (
            <Input {...p} autoComplete="given-name" maxLength={60} value={profile.preferredName} onChange={(e) => update("preferredName", e.target.value)} />
          )}
        </FormField>
        {select("classStanding", CLASS_STANDING_OPTIONS)}
        {select("major", PLACEHOLDER_MAJOR_OPTIONS)}
        {select("catalogYear", PLACEHOLDER_CATALOG_YEARS, "Usually the year you started at UF.")}
        {select("entryTerm", PLACEHOLDER_ENTRY_TERMS, "Used to count your semesters for Critical Tracking.")}
        {select("expectedGraduation", PLACEHOLDER_GRAD_TERMS)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={pending} pendingLabel="Saving…" className="h-10 px-5">
          Save profile
        </SubmitButton>
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {state.status === "success" ? state.message : ""}
        </p>
      </div>
    </form>
  )
}

/* ---------- survey ---------- */

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/New_York" })

function SurveySection() {
  const api = useApi()
  const fetcher = React.useCallback(() => api.getLatestSurvey(), [api])
  const { state, retry } = useLoad<SurveySubmission | null>(fetcher)

  return (
    <Section id="settings-survey" title="Interest survey" description="Your answers shape course recommendations.">
      {state.kind === "loading" && <LoadingBlock />}
      {state.kind === "error" && <LoadFailed error={state.error} onRetry={retry} />}
      {state.kind === "ok" && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm">
            {state.data ? `Last taken ${DATE.format(new Date(state.data.submittedAt))}.` : "You haven't taken the survey yet."}
          </p>
          {/* The survey screen is #19 (Zain). Link it here once it has a route. */}
          <Button variant="outline" className="h-10 px-4" disabled>
            {state.data ? "Retake survey" : "Take survey"} (coming soon)
          </Button>
        </div>
      )}
    </Section>
  )
}

/* ---------- courses ---------- */

function CoursesSection() {
  const api = useApi()
  const fetcher = React.useCallback(() => api.getCoursework(), [api])
  const { state, retry } = useLoad<Coursework>(fetcher)

  return (
    <Section id="settings-courses" title="Courses you've taken" description="Re-import your transcript or edit courses by hand.">
      {state.kind === "loading" && <LoadingBlock />}
      {state.kind === "error" && <LoadFailed error={state.error} onRetry={retry} />}
      {state.kind === "ok" && <CourseSummary coursework={state.data} />}
    </Section>
  )
}

function CourseSummary({ coursework }: { coursework: Coursework }) {
  const total = coursework.rows.length
  const review = coursework.rows.filter((r) => r.status === "needs-review").length
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm">
        {total === 0 ? "No courses on record." : `${total} ${total === 1 ? "course" : "courses"} on record.`}
        {review > 0 ? ` ${review} ${review === 1 ? "needs" : "need"} review.` : ""}
      </p>
      <Button variant="outline" className="h-10 px-4" render={<Link href="/import" />} nativeButton={false}>
        {total === 0 ? "Import courses" : "Re-import or edit courses"}
      </Button>
    </div>
  )
}

/* ---------- appearance ---------- */

function AppearanceSection() {
  const { dark, toggle } = useTheme()
  return (
    <Section id="settings-appearance" title="Appearance">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          Theme: <span className="font-medium">{dark ? "Dark" : "Light"}</span>
        </p>
        <Button variant="outline" className="h-10 px-4" onClick={toggle}>
          Use {dark ? "light" : "dark"} theme
        </Button>
      </div>
    </Section>
  )
}

/* ---------- delete account ---------- */

const CONFIRM_WORD = "delete"

function DeleteAccountSection({ onDeleted }: { onDeleted: () => void }) {
  const api = useApi()
  const [open, setOpen] = React.useState(false)
  const [typed, setTyped] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<ApiError | null>(null)

  function onOpenChange(next: boolean) {
    if (pending) return
    setOpen(next)
    if (!next) {
      setTyped("")
      setError(null)
    }
  }

  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (typed.trim().toLowerCase() !== CONFIRM_WORD) return
    setPending(true)
    setError(null)
    const result = await api.deleteAccount()
    setPending(false)
    if (result.ok) {
      setOpen(false)
      onDeleted()
    } else {
      setError(result.error)
    }
  }

  return (
    <Section
      id="settings-delete"
      danger
      title="Delete account"
      description="Permanently removes your account, profile, courses, survey answers, plans, schedules, and chats. This can't be undone."
    >
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger render={<Button variant="destructive" className="h-10 self-start px-4" />}>Delete account</DialogTrigger>
        <DialogContent>
          <form onSubmit={confirm} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                Everything you&apos;ve saved will be removed and can&apos;t be recovered.
              </DialogDescription>
            </DialogHeader>
            {error ? <ErrorPanel {...deleteErrorPanel(error)} /> : null}
            <FormField id="confirm-delete" label={`Type "${CONFIRM_WORD}" to confirm`}>
              {(p) => <Input {...p} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />}
            </FormField>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
              <SubmitButton variant="destructive" pending={pending} pendingLabel="Deleting…" disabled={pending || typed.trim().toLowerCase() !== CONFIRM_WORD}>
                {error ? "Try again" : "Delete account"}
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Section>
  )
}

/** A failed delete may have removed some data, so say so instead of the generic message. */
function deleteErrorPanel(error: ApiError) {
  if (error.code === "SERVER" || error.code === "NETWORK") {
    return {
      title: "Your account wasn't fully deleted",
      description: "Some of your data may still be stored. Try again. We'll only confirm once everything is gone.",
    }
  }
  return toErrorPanel(error)
}
