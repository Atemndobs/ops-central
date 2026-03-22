import { Plus, Search, Filter, ClipboardList } from "lucide-react";

/**
 * JOBS PAGE - Job list and management
 *
 * Design brief for designer:
 * - Table/card list of all jobs with filters
 * - Status badges: Scheduled (gray), Assigned (blue), In Progress (yellow), Completed (green), Issues (red)
 * - Filters: status, property, cleaner, date range
 * - Search by property name or job ID
 * - Click row → job detail page
 * - Bulk actions: assign, reschedule, approve
 * - "New Job" button opens creation modal
 */
export default function JobsPage() {
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5">
            <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
            <input
              type="text"
              placeholder="Search jobs..."
              className="bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
            />
          </div>
          {/* Filters */}
          <button className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]">
            <Filter className="h-4 w-4" />
            Filter
          </button>
        </div>
        <button className="flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
          <Plus className="h-4 w-4" />
          New Job
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {[
          { label: "All", count: "—" },
          { label: "Scheduled", count: "—" },
          { label: "Assigned", count: "—" },
          { label: "In Progress", count: "—" },
          { label: "Completed", count: "—" },
          { label: "Issues", count: "—" },
        ].map((tab) => (
          <button
            key={tab.label}
            className="border-b-2 border-transparent px-4 py-2 text-sm text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]"
          >
            {tab.label}{" "}
            <span className="ml-1 text-xs opacity-60">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Job list placeholder */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div className="flex items-center justify-center py-24 text-sm text-[var(--muted-foreground)]">
          <div className="text-center">
            <ClipboardList className="mx-auto h-8 w-8 mb-2 opacity-40" />
            <p>Jobs will appear here</p>
            <p className="text-xs mt-1">
              Filterable table with status, property, cleaner, and date
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
