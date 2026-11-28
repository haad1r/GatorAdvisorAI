"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "../ui/button"
import { FormErrorSummary } from "../forms/form-error-summary"
import { SubmitButton } from "../forms/submit-button"
import { errorState, fieldError, fieldIds, hasErrors, initialFormState, type FormState } from "../../lib/forms"
import { toFormState } from "../../lib/api/errors"
import { useApi } from "../../lib/api/use-api"
import type { SurveyQuestionId, SurveySubmission } from "../../lib/api/types"
import {
  INTEREST_GROUPS,
  SURVEY_LABELS,
  SURVEY_QUESTIONS,
  initialDraft,
  isHidden,
  toSubmission,
  validateSurvey,
  type SurveyDraft,
  type SurveyQuestion,
} from "../../lib/survey"

/** The two interest questions can't share a topic: picking one turns it off in the other. */
const OTHER_LIST: Partial<Record<SurveyQuestionId, SurveyQuestionId>> = {
  interests: "lower_interest_topics",
  lower_interest_topics: "interests",
}

const DISABLED_REASON: Partial<Record<SurveyQuestionId, string>> = {
  interests: "Topics you marked as less interesting below are turned off here. Remove them there to pick them.",
  lower_interest_topics: "Topics you picked as interests above are turned off here. Remove them there to pick them.",
}

/**
 * The interest survey (#19 part A). Used as the last onboarding step and for
 * retakes from Settings. Every question is optional; nothing is sent until the
 * student presses the submit button, and a failed save keeps every answer.
 */
export function SurveyForm({
  major,
  last,
  header,
  secondaryAction,
  submitLabel = "Save answers",
  onSaved,
}: {
  /** The student's major value. "undeclared" hides Q3 and starts Q6 at "exploring". */
  major: string
  /** The latest saved submission, to pre-fill a retake. */
  last: SurveySubmission | null
  /** Rendered first inside the form, e.g. the step heading. */
  header?: React.ReactNode
  /** "Skip for now" or "Cancel", owned by the caller. */
  secondaryAction?: React.ReactNode
  submitLabel?: string
  onSaved: (saved: SurveySubmission) => void
}) {
  const api = useApi()
  const [draft, setDraft] = React.useState<SurveyDraft>(() => initialDraft(last, major))
  const [state, setState] = React.useState<FormState>(initialFormState)
  const [pending, setPending] = React.useState(false)

  function set(id: SurveyQuestionId, value: string | string[] | undefined) {
    setDraft((d) => {
      const next = { ...d }
      if (value === undefined) delete next[id]
      else next[id] = value
      return next
    })
    // Clear that question's error, and the overlap error when either list changes.
    setState((s) => {
      if (!s.fieldErrors) return s
      const fieldErrors = { ...s.fieldErrors, [id]: undefined }
      if (OTHER_LIST[id]) fieldErrors.lower_interest_topics = undefined
      return { ...s, fieldErrors }
    })
  }

  function toggle(id: SurveyQuestionId, topic: string) {
    const current = (draft[id] as string[] | undefined) ?? []
    const next = current.includes(topic) ? current.filter((t) => t !== topic) : [...current, topic]
    set(id, next.length ? next : undefined)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const submission = toSubmission(draft, major)
    const errors = validateSurvey(submission)
    if (hasErrors(errors)) return setState(errorState(errors))

    setPending(true)
    try {
      const result = await api.submitSurvey(submission)
      if (result.ok) return onSaved(result.data)
      setState(toFormState(result.error))
    } catch {
      setState({
        status: "error",
        message: "We couldn't save your answers. Check your connection and try again.",
        submittedAt: Date.now(),
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-6">
      {header}
      <p className="text-sm text-muted-foreground">
        Every question is optional. Your answers only change how courses are ranked; they never hide a course.
      </p>

      <FormErrorSummary state={state} labels={SURVEY_LABELS} title="We couldn't save your answers" />

      {SURVEY_QUESTIONS.filter((q) => !isHidden(q.id, major)).map((q) =>
        q.type === "multi_choice" ? (
          <TopicQuestion
            key={q.id}
            question={q}
            selected={(draft[q.id] as string[] | undefined) ?? []}
            disabled={(draft[OTHER_LIST[q.id]!] as string[] | undefined) ?? []}
            error={fieldError(state, q.id)}
            onToggle={(topic) => toggle(q.id, topic)}
            onClear={() => set(q.id, undefined)}
          />
        ) : (
          <ChoiceQuestion
            key={q.id}
            question={q}
            value={(draft[q.id] as string | undefined) ?? ""}
            error={fieldError(state, q.id)}
            onChange={(value) => set(q.id, value)}
            onClear={() => set(q.id, undefined)}
          />
        )
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        {secondaryAction ?? <span />}
        <SubmitButton pending={pending} pendingLabel="Saving…">
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  )
}

/* ---------- questions ---------- */

function QuestionShell({
  question,
  hasAnswer,
  error,
  note,
  onClear,
  children,
}: {
  question: SurveyQuestion
  hasAnswer: boolean
  error?: string
  /** Extra explanation, e.g. why some topics are turned off. */
  note?: string
  onClear: () => void
  children: React.ReactNode
}) {
  const ids = fieldIds(question.id)
  const noteId = `${question.id}-note`
  const describedBy =
    [question.help && ids.description, note && noteId, error && ids.error].filter(Boolean).join(" ") || undefined
  const clear = (
    <Button type="button" variant="link" size="sm" onClick={onClear} aria-label={`Clear answer: ${question.short}`}>
      Clear
    </Button>
  )

  return (
    <fieldset
      id={question.id}
      aria-describedby={describedBy}
      data-invalid={error ? "" : undefined}
      className={cn("flex min-w-0 flex-col gap-2", error && "rounded-lg outline outline-offset-4 outline-destructive/60")}
    >
      <legend className="mb-1 text-sm font-medium">
        {question.text} <span className="font-normal text-muted-foreground">(optional)</span>
      </legend>
      {question.help ? (
        <div className="flex min-h-7 items-center justify-between gap-2">
          <p id={ids.description} className="text-xs text-muted-foreground">
            {question.help}
          </p>
          {hasAnswer ? clear : null}
        </div>
      ) : null}
      {note ? (
        <p id={noteId} className="text-xs text-muted-foreground">
          {note}
        </p>
      ) : null}
      {children}
      {/* Without a help line, Clear goes under the options so nothing above them moves. */}
      {!question.help && hasAnswer ? <div className="flex justify-end">{clear}</div> : null}
      {error ? (
        <p id={ids.error} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}

function TopicQuestion({
  question,
  selected,
  disabled,
  error,
  onToggle,
  onClear,
}: {
  question: SurveyQuestion
  selected: string[]
  /** Topics picked in the other list. */
  disabled: string[]
  error?: string
  onToggle: (topic: string) => void
  onClear: () => void
}) {
  const blocked = disabled.filter((t) => !selected.includes(t))
  return (
    <QuestionShell
      question={question}
      hasAnswer={selected.length > 0}
      error={error}
      note={blocked.length ? DISABLED_REASON[question.id] : undefined}
      onClear={onClear}
    >
      <div className="flex flex-col gap-3">
        {INTEREST_GROUPS.map((group) => {
          const groupId = `${question.id}-${group.id}`
          return (
            <div key={group.id} role="group" aria-labelledby={groupId} className="flex flex-col gap-1.5">
              <p id={groupId} className="text-xs font-medium text-muted-foreground">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {group.interests.map((topic) => {
                  const checked = selected.includes(topic.value)
                  const off = !checked && blocked.includes(topic.value)
                  return (
                    <label
                      key={topic.value}
                      className={cn(
                        "relative inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs transition-colors select-none hover:bg-muted",
                        "has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground",
                        "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                        "has-disabled:cursor-not-allowed has-disabled:border-dashed has-disabled:bg-transparent has-disabled:text-muted-foreground has-disabled:line-through has-disabled:hover:bg-transparent"
                      )}
                    >
                      <input
                        type="checkbox"
                        // Transparent and covering the chip, so a click or tap hits the real input.
                        className="absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed"
                        name={question.id}
                        value={topic.value}
                        checked={checked}
                        disabled={off}
                        onChange={() => onToggle(topic.value)}
                      />
                      {checked ? <CheckIcon aria-hidden="true" className="size-3" /> : null}
                      {topic.label}
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </QuestionShell>
  )
}

function ChoiceQuestion({
  question,
  value,
  error,
  onChange,
  onClear,
}: {
  question: Extract<SurveyQuestion, { type: "single_choice" }>
  value: string
  error?: string
  onChange: (value: string) => void
  onClear: () => void
}) {
  return (
    <QuestionShell question={question} hasAnswer={value !== ""} error={error} onClear={onClear}>
      <div className="flex flex-col gap-1">
        {question.options.map((option) => (
          <label key={option.value} className="flex min-h-7 cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              className="size-4 accent-primary"
              name={question.id}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </QuestionShell>
  )
}
