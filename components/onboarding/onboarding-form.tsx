"use client"

import * as React from "react"
import Link from "next/link"
import { CheckIcon, InfoIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { NativeSelect } from "../ui/native-select"
import { FormField } from "../forms/form-field"
import { FormErrorSummary } from "../forms/form-error-summary"
import { SubmitButton } from "../forms/submit-button"
import { Alert, AlertDescription, AlertTitle } from "../ui/alert"
import {
  errorState,
  fieldError,
  hasErrors,
  initialFormState,
  type FormState,
} from "../../lib/forms"
import {
  CLASS_STANDING_OPTIONS,
  ONBOARDING_STEPS,
  PLACEHOLDER_CATALOG_YEARS,
  PLACEHOLDER_GRAD_TERMS,
  PLACEHOLDER_MAJOR_OPTIONS,
  PROFILE_LABELS,
  emptyProfile,
  validateProfile,
  type OnboardingProfile,
  type Option,
} from "../../lib/onboarding"

/** Matches the raised, frosted card Clerk uses for sign-in and sign-up. */
const clerkCardClass =
  "w-full max-w-[25rem] rounded-2xl border border-black/8 bg-white/80 p-8 backdrop-blur-[20px] dark:border-white/10 dark:bg-neutral-900/80"

const clerkCardStyle = {
  boxShadow:
    "0 5px 15px rgba(0, 0, 0, 0.08), 0 15px 35px -5px rgba(25, 28, 33, 0.2)",
} as const

/**
 * Presentation-only onboarding flow (checkpoint 1).
 * `onSubmit` defaults to a local mock; swap in the authenticated API
 * client call once the backend endpoint exists.
 */
export function OnboardingForm({
  onSubmit = mockSave,
}: {
  onSubmit?: (profile: OnboardingProfile) => Promise<FormState>
}) {
  const [step, setStep] = React.useState(0)
  const [profile, setProfile] = React.useState<OnboardingProfile>(emptyProfile)
  const [state, setState] = React.useState<FormState>(initialFormState)
  const [pending, setPending] = React.useState(false)
  const headingRef = React.useRef<HTMLHeadingElement>(null)

  const current = ONBOARDING_STEPS[step]
  const isReview = current.id === "review"

  function update(field: keyof OnboardingProfile, value: string) {
    setProfile((p) => ({ ...p, [field]: value }))
    // Clear that field's error as soon as the user fixes it.
    if (state.fieldErrors?.[field]) {
      setState((s) => ({
        ...s,
        fieldErrors: { ...s.fieldErrors, [field]: undefined },
      }))
    }
  }

  function goTo(next: number) {
    setStep(next)
    setState(initialFormState)
    // Move focus to the new step's heading for screen readers / keyboard.
    requestAnimationFrame(() => headingRef.current?.focus())
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!isReview) {
      const errors = validateProfile(profile, current.fields)
      if (hasErrors(errors)) return setState(errorState(errors))
      return goTo(step + 1)
    }

    const errors = validateProfile(profile)
    if (hasErrors(errors)) return setState(errorState(errors))
    setPending(true)
    try {
      setState(await onSubmit(profile))
    } catch {
      setState({
        status: "error",
        message: "We couldn't save your profile. Check your connection and try again.",
        submittedAt: Date.now(),
      })
    } finally {
      setPending(false)
    }
  }

  if (state.status === "success") {
    return <Done name={profile.preferredName} />
  }

  return (
    <div className={cn(clerkCardClass, "flex flex-col gap-6")} style={clerkCardStyle}>
      <StepIndicator current={step} />

      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-lg font-semibold outline-none"
        >
          {current.title}
        </h2>

        <FormErrorSummary state={state} labels={PROFILE_LABELS} />

        {current.id === "about" ? (
          <>
            <FormField
              id="preferredName"
              label={PROFILE_LABELS.preferredName}
              description="Shown in your dashboard and advisor chat."
              error={fieldError(state, "preferredName")}
              required
            >
              {(p) => (
                <Input
                  {...p}
                  autoComplete="given-name"
                  maxLength={60}
                  value={profile.preferredName}
                  onChange={(e) => update("preferredName", e.target.value)}
                />
              )}
            </FormField>
            <SelectField
              field="classStanding"
              options={CLASS_STANDING_OPTIONS}
              profile={profile}
              state={state}
              update={update}
            />
          </>
        ) : null}

        {current.id === "program" ? (
          <>
            <SelectField
              field="major"
              options={PLACEHOLDER_MAJOR_OPTIONS}
              profile={profile}
              state={state}
              update={update}
            />
            <SelectField
              field="catalogYear"
              description="Usually the year you started at UF. It decides which requirements apply to you."
              options={PLACEHOLDER_CATALOG_YEARS}
              profile={profile}
              state={state}
              update={update}
            />
            <SelectField
              field="expectedGraduation"
              options={PLACEHOLDER_GRAD_TERMS}
              profile={profile}
              state={state}
              update={update}
            />
          </>
        ) : null}

        {isReview ? <Review profile={profile} onEdit={goTo} /> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {step > 0 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => goTo(step - 1)}
              disabled={pending}
            >
              Back
            </Button>
          ) : (
            <span />
          )}
          <SubmitButton pending={pending} pendingLabel="Saving…">
            {isReview ? "Finish setup" : "Continue"}
          </SubmitButton>
        </div>
      </form>
    </div>
  )
}

function SelectField({
  field,
  options,
  description,
  profile,
  state,
  update,
}: {
  field: keyof OnboardingProfile
  options: Option[]
  description?: string
  profile: OnboardingProfile
  state: FormState
  update: (field: keyof OnboardingProfile, value: string) => void
}) {
  return (
    <FormField
      id={field}
      label={PROFILE_LABELS[field]}
      description={description}
      error={fieldError(state, field)}
      required
    >
      {(p) => (
        <NativeSelect
          {...p}
          value={profile[field]}
          onChange={(e) => update(field, e.target.value)}
        >
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
}

function StepIndicator({ current }: { current: number }) {
  return (
    <nav aria-label="Onboarding progress">
      <p className="mb-2 text-xs text-muted-foreground">
        Step {current + 1} of {ONBOARDING_STEPS.length}
      </p>
      <ol className="flex gap-2">
        {ONBOARDING_STEPS.map((s, i) => (
          <li
            key={s.id}
            aria-current={i === current ? "step" : undefined}
            className="flex flex-1 flex-col gap-1.5"
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-1 rounded-full",
                i <= current ? "bg-primary" : "bg-muted"
              )}
            />
            <span
              className={cn(
                "text-xs",
                i === current ? "font-medium" : "text-muted-foreground"
              )}
            >
              {i < current ? <span className="sr-only">Completed: </span> : null}
              {s.title}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function labelFor(field: keyof OnboardingProfile, value: string) {
  const lists: Partial<Record<keyof OnboardingProfile, Option[]>> = {
    classStanding: CLASS_STANDING_OPTIONS,
    major: PLACEHOLDER_MAJOR_OPTIONS,
  }
  return lists[field]?.find((o) => o.value === value)?.label ?? value
}

function Review({
  profile,
  onEdit,
}: {
  profile: OnboardingProfile
  onEdit: (step: number) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {ONBOARDING_STEPS.slice(0, -1).map((s, i) => (
        <section key={s.id} className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">{s.title}</h3>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => onEdit(i)}
              aria-label={`Edit ${s.title}`}
            >
              Edit
            </Button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {s.fields.map((f) => (
              <React.Fragment key={f}>
                <dt className="text-muted-foreground">{PROFILE_LABELS[f]}</dt>
                <dd className="break-words">
                  {labelFor(f, profile[f]) || "—"}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

function Done({ name }: { name: string }) {
  return (
    <div
      className={cn(clerkCardClass, "flex flex-col gap-5")}
      style={clerkCardStyle}
      role="status"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <CheckIcon aria-hidden="true" className="size-5" />
        </span>
        <h2 className="text-lg font-semibold">You&apos;re all set, {name.trim()}.</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Next, import your transcript so we can mark the courses you&apos;ve
        already completed. You can also do this later.
      </p>
      <Alert>
        <InfoIcon aria-hidden="true" />
        <AlertTitle>Preview build</AlertTitle>
        <AlertDescription>
          Your answers weren&apos;t saved. Onboarding isn&apos;t connected to the
          backend yet.
        </AlertDescription>
      </Alert>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button disabled>Import transcript (coming soon)</Button>
        <Button variant="outline" render={<Link href="/" />} nativeButton={false}>
          Skip for now
        </Button>
      </div>
    </div>
  )
}

/** Local stand-in for the onboarding API call. */
async function mockSave(): Promise<FormState> {
  await new Promise((r) => setTimeout(r, 600))
  return { status: "success", message: "Profile saved." }
}