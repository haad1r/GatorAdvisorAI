"use client"

import * as React from "react"
import { PlusIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { EmptyState } from "@/components/feedback/empty-state"
import { ErrorPanel } from "@/components/feedback/error-panel"
import { LoadFailed } from "@/components/feedback/load-failed"
import { LoadingBlock } from "@/components/feedback/loading-block"
import { FormErrorSummary } from "@/components/forms/form-error-summary"
import { FormField } from "@/components/forms/form-field"
import { SubmitButton } from "@/components/forms/submit-button"
import { toErrorPanel, toFormState } from "@/lib/api/errors"
import type { ApiError, Coursework, CourseworkRow } from "@/lib/api/types"
import { useApi } from "@/lib/api/use-api"
import { useLoad } from "@/lib/api/use-load"
import { errorState, fieldError, hasErrors, initialFormState, type FieldErrors, type FormState } from "@/lib/forms"
import { formatCourseCode } from "@/lib/format"

/*
 * PLACEHOLDER WORDING (#19 step 9): whether an import replaces or merges with
 * saved courses is TEAM-03's (#9) decision. Swap these strings when it's made.
 */
export const IMPORT_COPY = {
  uploadTitle: "Import your transcript",
  uploadBody:
    "Upload your unofficial UF transcript (PDF) and we'll read your courses into the table below for you to check. Nothing is saved until you press Save.",
  replaceOrMerge:
    "Importing will add the courses we find to this list. Courses already here stay unless you remove them.",
  uploadUnavailable: "Transcript upload isn't connected yet.",
  manualFallback: "Scanned or unsupported file? Add your courses by hand with “Add course” below.",
}

/** Same rule as the API: three letters, four digits, optional lab letter. */
const COURSE_CODE = /^[A-Z]{3}\d{4}[A-Z]?$/

/** "cop 3502" -> "COP3502". */
export function normalizeCourseCode(value: string) {
  return value.toUpperCase().replace(/\s+/g, "")
}

const FIELDS = ["courseCode", "grade", "credits", "term"] as const
type Field = (typeof FIELDS)[number]

const FIELD_LABEL: Record<Field, string> = {
  courseCode: "Course",
  grade: "Grade",
  credits: "Credits",
  term: "Term",
}

const key = (i: number, field: Field) => `rows.${i}.${field}`

/** Client-side check, mirroring the API's so errors show before a round trip. */
function validateRows(rows: CourseworkRow[]): FieldErrors {
  const errors: FieldErrors = {}
  rows.forEach((r, i) => {
    if (!COURSE_CODE.test(r.courseCode)) errors[key(i, "courseCode")] = ["Use a course code like COP3502."]
    if (!r.grade.trim()) errors[key(i, "grade")] = ["Enter a grade."]
    if (!(r.credits > 0)) errors[key(i, "credits")] = ["Credits must be more than 0."]
    if (!r.term.trim()) errors[key(i, "term")] = ["Enter a term, like Fall 2025."]
  })
  return errors
}

/** Rows that need review first, otherwise the saved order (#19 step 6). */
function reviewFirst(rows: CourseworkRow[]) {
  return [...rows].sort((a, b) => Number(b.status === "needs-review") - Number(a.status === "needs-review"))
}

/* Import (#19, part B): review, edit, and save the courses you've taken. */
export function ImportView() {
  const api = useApi()
  const fetcher = React.useCallback(() => api.getCoursework(), [api])
  const { state, retry } = useLoad(fetcher)

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <UploadSection />
      {state.kind === "loading" && <LoadingBlock />}
      {state.kind === "error" && <LoadFailed error={state.error} onRetry={retry} />}
      {state.kind === "ok" && <CourseEditor key={state.data.version} saved={state.data} onReload={retry} />}
    </div>
  )
}

function UploadSection() {
  return (
    <section aria-labelledby="import-upload" className="flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4 lg:px-6 lg:py-5">
      <h2 id="import-upload" className="text-base font-semibold lg:text-lg">
        {IMPORT_COPY.uploadTitle}
      </h2>
      <p className="text-sm">{IMPORT_COPY.uploadBody}</p>
      <p className="text-sm text-muted-foreground">{IMPORT_COPY.replaceOrMerge}</p>
      <div className="flex flex-wrap items-center gap-3">
        {/* Parsing is #9 (Maria/Shaun). Enable once its preview endpoint exists. */}
        <Button variant="outline" disabled>
          <UploadIcon aria-hidden="true" />
          Upload transcript (coming soon)
        </Button>
        <span className="text-sm text-muted-foreground">{IMPORT_COPY.uploadUnavailable}</span>
      </div>
      <p className="text-sm">{IMPORT_COPY.manualFallback}</p>
    </section>
  )
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "stale"; error: ApiError }
  | { kind: "failed"; error: ApiError }

let newRowCount = 0

function CourseEditor({ saved, onReload }: { saved: Coursework; onReload: () => void }) {
  const api = useApi()
  const [rows, setRows] = React.useState(() => reviewFirst(saved.rows))
  const [baseline, setBaseline] = React.useState(() => reviewFirst(saved.rows))
  const [version, setVersion] = React.useState(saved.version)
  const [form, setForm] = React.useState<FormState>(initialFormState)
  const [save, setSave] = React.useState<SaveState>({ kind: "idle" })
  const [pending, setPending] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [announce, setAnnounce] = React.useState("")
  const addRef = React.useRef<HTMLButtonElement>(null)

  const dirty = JSON.stringify(rows) !== JSON.stringify(baseline)
  const changes = summarize(baseline, rows)
  const toReview = rows.filter((r) => r.status === "needs-review").length

  function touch() {
    if (save.kind === "saved") setSave({ kind: "idle" })
  }

  function update(i: number, patch: Partial<CourseworkRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    const changed = Object.keys(patch) as Field[]
    setForm((f) => {
      if (!f.fieldErrors) return f
      const next = { ...f.fieldErrors }
      for (const field of changed) delete next[key(i, field)]
      return { ...f, fieldErrors: next }
    })
    touch()
  }

  function blurCode(i: number) {
    const code = normalizeCourseCode(rows[i].courseCode)
    if (code !== rows[i].courseCode) update(i, { courseCode: code })
    setForm((f) => ({
      ...f,
      fieldErrors: {
        ...f.fieldErrors,
        [key(i, "courseCode")]: code && !COURSE_CODE.test(code) ? ["Use a course code like COP3502."] : undefined,
      },
    }))
  }

  function add() {
    newRowCount += 1
    setRows((rs) => [
      ...rs,
      { id: `new-${newRowCount}`, courseCode: "", grade: "", credits: 3, term: "", source: "manual", status: "confirmed" },
    ])
    setForm(initialFormState)
    touch()
    requestAnimationFrame(() => document.getElementById(key(rows.length, "courseCode"))?.focus())
  }

  function remove(i: number) {
    const code = rows[i].courseCode || "the new course"
    setRows((rs) => rs.filter((_, j) => j !== i))
    setForm(initialFormState)
    setAnnounce(`Removed ${formatCourseCode(code)}. Not saved yet.`)
    touch()
    requestAnimationFrame(() => addRef.current?.focus())
  }

  function review() {
    const errors = validateRows(rows)
    if (hasErrors(errors)) return setForm(errorState(errors, "Fix these before saving."))
    setForm(initialFormState)
    setConfirming(true)
  }

  async function confirmSave(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    const result = await api.saveCoursework({ version, rows })
    setPending(false)
    setConfirming(false)
    if (result.ok) {
      const next = reviewFirst(result.data.rows)
      setRows(next)
      setBaseline(next)
      setVersion(result.data.version)
      setSave({ kind: "saved" })
      setAnnounce("Courses saved.")
      return
    }
    // Every failure keeps the edits on screen (#19 step 8).
    if (result.error.code === "STALE_WRITE") setSave({ kind: "stale", error: result.error })
    else {
      setSave({ kind: "failed", error: result.error })
      if (result.error.code === "VALIDATION_ERROR") setForm(toFormState(result.error))
    }
  }

  const labels = Object.fromEntries(
    rows.flatMap((r, i) => FIELDS.map((f) => [key(i, f), `Row ${i + 1} (${r.courseCode || "new course"}) ${FIELD_LABEL[f].toLowerCase()}`]))
  )

  return (
    <section aria-labelledby="import-courses" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="import-courses" className="text-base font-semibold lg:text-lg">
          Courses you&apos;ve taken
        </h2>
        <p className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "course" : "courses"}
          {toReview > 0 ? ` · ${toReview} to review` : ""}
        </p>
      </div>

      {save.kind === "stale" && (
        <Alert variant="destructive">
          <AlertTitle>{toErrorPanel(save.error).title}</AlertTitle>
          <AlertDescription>
            <p>Your courses changed somewhere else since you opened this page. Your edits are still here, but saving them would overwrite those changes.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={onReload}>
              Discard my edits and load the latest
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {save.kind === "failed" && save.error.code !== "VALIDATION_ERROR" && (
        <div className="flex flex-col gap-1">
          <ErrorPanel {...toErrorPanel(save.error)} />
          <p className="text-sm text-muted-foreground">Nothing was saved. Your edits are still here.</p>
        </div>
      )}
      <FormErrorSummary state={form} labels={labels} />

      {rows.length === 0 ? (
        <EmptyState title="No courses yet" description="Import your transcript, or add courses by hand." />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <li key={r.id}>
              <RowEditor row={r} index={i} form={form} onChange={(p) => update(i, p)} onBlurCode={() => blurCode(i)} onRemove={() => remove(i)} />
            </li>
          ))}
        </ul>
      )}

      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button ref={addRef} variant="outline" onClick={add} className="self-start">
          <PlusIcon aria-hidden="true" />
          Add course
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm" aria-live="polite">
            {save.kind === "saved" && !dirty ? "Saved." : dirty ? "Unsaved changes" : ""}
          </p>
          <Button onClick={review} disabled={!dirty || pending}>
            Review and save
          </Button>
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={(open) => !pending && setConfirming(open)}>
        <DialogContent>
          <form onSubmit={confirmSave} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Save your courses?</DialogTitle>
              <DialogDescription>Your degree audit and recommendations will update to match.</DialogDescription>
            </DialogHeader>
            <ul className="list-disc pl-5 text-sm">
              {changes.added > 0 && <li>{changes.added} added</li>}
              {changes.edited > 0 && <li>{changes.edited} changed</li>}
              {changes.removed > 0 && <li>{changes.removed} removed</li>}
            </ul>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={pending} />}>Keep editing</DialogClose>
              <SubmitButton pending={pending} pendingLabel="Saving…">
                Save courses
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function summarize(before: CourseworkRow[], after: CourseworkRow[]) {
  const old = new Map(before.map((r) => [r.id, JSON.stringify(r)]))
  const now = new Set(after.map((r) => r.id))
  return {
    added: after.filter((r) => !old.has(r.id)).length,
    edited: after.filter((r) => old.has(r.id) && old.get(r.id) !== JSON.stringify(r)).length,
    removed: before.filter((r) => !now.has(r.id)).length,
  }
}

function RowEditor({
  row,
  index: i,
  form,
  onChange,
  onBlurCode,
  onRemove,
}: {
  row: CourseworkRow
  index: number
  form: FormState
  onChange: (patch: Partial<CourseworkRow>) => void
  onBlurCode: () => void
  onRemove: () => void
}) {
  const review = row.status === "needs-review"
  const name = row.courseCode ? formatCourseCode(row.courseCode) : "new course"
  return (
    <fieldset className={review ? "rounded-xl border border-brand-orange/70 bg-brand-orange/5 p-4" : "rounded-xl border border-border bg-card p-4"}>
      <legend className="sr-only">
        Row {i + 1}: {name}
        {review ? ", needs review" : ""}
      </legend>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {review ? (
          <span className="rounded-full border border-brand-orange/60 bg-brand-orange/20 px-2 text-xs font-medium">Needs review</span>
        ) : (
          <span className="text-xs text-muted-foreground">Confirmed</span>
        )}
        <span className="text-xs text-muted-foreground">· {row.source === "transcript" ? "From transcript" : "Added by hand"}</span>
        <div className="ml-auto flex items-center gap-1">
          {review && (
            <Button variant="ghost" size="sm" onClick={() => onChange({ status: "confirmed" })}>
              Mark as correct<span className="sr-only"> for {name}</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onRemove}>
            <Trash2Icon aria-hidden="true" />
            Remove<span className="sr-only"> {name}</span>
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FormField id={key(i, "courseCode")} label={FIELD_LABEL.courseCode} error={fieldError(form, key(i, "courseCode"))} required>
          {(p) => (
            <Input {...p} value={row.courseCode} placeholder="e.g. COP3502" autoCapitalize="characters" onChange={(e) => onChange({ courseCode: e.target.value })} onBlur={onBlurCode} />
          )}
        </FormField>
        <FormField id={key(i, "grade")} label={FIELD_LABEL.grade} error={fieldError(form, key(i, "grade"))} required>
          {(p) => <Input {...p} value={row.grade} placeholder="e.g. B+" maxLength={3} onChange={(e) => onChange({ grade: e.target.value.toUpperCase() })} />}
        </FormField>
        <FormField id={key(i, "credits")} label={FIELD_LABEL.credits} error={fieldError(form, key(i, "credits"))} required>
          {(p) => (
            <NativeSelect {...p} value={String(row.credits)} onChange={(e) => onChange({ credits: Number(e.target.value) })}>
              {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n} disabled={n === 0}>
                  {n === 0 ? "Select…" : n}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id={key(i, "term")} label={FIELD_LABEL.term} error={fieldError(form, key(i, "term"))} required>
          {(p) => <Input {...p} value={row.term} placeholder="e.g. Fall 2025" onChange={(e) => onChange({ term: e.target.value })} />}
        </FormField>
      </div>
    </fieldset>
  )
}
