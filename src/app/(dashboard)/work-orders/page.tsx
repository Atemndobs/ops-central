import { Plus, Search, Wrench } from "lucide-react";

/**
 * WORK ORDERS PAGE - Maintenance requests
 *
 * Design brief for designer:
 * - Table/card list of work orders
 * - Priority badges: Low (gray), Medium (blue), High (orange), Urgent (red)
 * - Status: Created → Assigned → In Progress → Completed → Approved
 * - Columns: Property, Issue, Priority, Assigned To, Due Date, Status
 * - Created from: inspection failures, cleaner incident reports, or manual
 * - Click → work order detail page
 * - Vendor management sub-tab
 */
export default function WorkOrdersPage() {
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5">
            <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
            <input
              type="text"
              placeholder="Search work orders..."
              className="bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
            />
          </div>
        </div>
        <button className="flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
          <Plus className="h-4 w-4" />
          New Work Order
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {["All Orders", "Open", "In Progress", "Completed", "Vendors"].map(
          (tab) => (
            <button
              key={tab}
              className="border-b-2 border-transparent px-4 py-2 text-sm text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]"
            >
              {tab}
            </button>
          ),
        )}
      </div>

      {/* Work orders placeholder */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <div className="flex items-center justify-center py-24 text-sm text-[var(--muted-foreground)]">
          <div className="text-center">
            <Wrench className="mx-auto h-8 w-8 mb-2 opacity-40" />
            <p>Work orders will load from Convex</p>
            <p className="text-xs mt-1">
              Created from inspections, incident reports, or manually
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
