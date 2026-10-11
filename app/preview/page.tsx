import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { StatusBadge } from "@/components/feedback/status-badge";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { FormField } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { fieldError, type FormState } from "@/lib/forms";

const demoState: FormState = {
  status: "error",
  message: "Please fix the highlighted fields.",
  fieldErrors: { email: ["Use your @ufl.edu address."] },
};

export default function PreviewPage() {
  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col gap-8 p-8">
      <h1 className="text-xl font-semibold">Component preview</h1>
      <p className="text-sm text-muted-foreground">
        Static examples of shared loading, empty, error, and status UI. Not
        wired to APIs or sign-in.
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Status</h2>
        <div className="flex flex-wrap gap-2">
          <StatusBadge kind="idle" label="Not started" />
          <StatusBadge kind="loading" label="Loading" />
          <StatusBadge kind="success" label="Saved" />
          <StatusBadge kind="error" label="Failed" />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Loading</h2>
        <LoadingBlock />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Empty</h2>
        <EmptyState
          title="No items yet"
          description="There is nothing to show in this list."
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Error</h2>
        <ErrorPanel
          title="Could not load"
          description="The request failed. Try again in a moment."
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">Forms</h2>
        <FormErrorSummary
          state={demoState}
          labels={{ email: "UF email" }}
        />
        <FormField
          id="demo-name"
          label="Preferred name"
          description="Helper text sits under the control."
          required
        >
          {(p) => <Input {...p} placeholder="Albert" />}
        </FormField>
        <FormField
          id="email"
          label="UF email"
          error={fieldError(demoState, "email")}
          required
        >
          {(p) => <Input {...p} type="email" defaultValue="albert@gmail.com" />}
        </FormField>
        <FormField id="demo-standing" label="Class standing">
          {(p) => (
            <NativeSelect {...p} defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              <option value="freshman">Freshman</option>
              <option value="sophomore">Sophomore</option>
            </NativeSelect>
          )}
        </FormField>
        <div className="flex gap-2">
          <SubmitButton pending={false}>Save</SubmitButton>
          <SubmitButton pending>Save</SubmitButton>
        </div>
      </section>
    </main>
  );
}