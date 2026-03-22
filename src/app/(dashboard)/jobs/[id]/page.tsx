/**
 * JOB DETAIL PAGE
 *
 * Design brief for designer:
 * - Full job detail with status workflow bar at top
 * - Status transitions: Scheduled → Assigned → In Progress → Completed → Approved
 * - Left column: job info (property, cleaner, date, time, notes, checklist)
 * - Right column: photo gallery from cleaner, activity log
 * - Action buttons: Approve, Request Rework, Reassign, Cancel
 * - Checklist view (items from template, pass/fail for each)
 * - Comments/notes section at bottom
 */
export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      {/* Status workflow bar */}
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        {["Scheduled", "Assigned", "In Progress", "Completed", "Approved"].map(
          (step, i) => (
            <div key={step} className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border)] text-xs">
                  {i + 1}
                </div>
                <span className="text-sm">{step}</span>
              </div>
              {i < 4 && (
                <div className="h-px w-8 bg-[var(--border)]" />
              )}
            </div>
          ),
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Job info */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="text-sm font-semibold mb-4">Job Details</h3>
            <p className="text-sm text-[var(--muted-foreground)]">
              Job ID: {id} — Connect to Convex to load details
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="text-sm font-semibold mb-4">Checklist</h3>
            <p className="text-sm text-[var(--muted-foreground)]">
              Section → Room → Item checklist will render here
            </p>
          </div>
        </div>

        {/* Sidebar: photos + activity */}
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="text-sm font-semibold mb-4">Photos</h3>
            <p className="text-sm text-[var(--muted-foreground)]">
              Photos from cleaner will display here
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="text-sm font-semibold mb-4">Activity</h3>
            <p className="text-sm text-[var(--muted-foreground)]">
              Activity log and comments
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
