import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorPanel } from "@/components/feedback/error-panel";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { StatusBadge } from "@/components/feedback/status-badge";

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
    </main>
  );
}