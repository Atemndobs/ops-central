import { Calendar, ChevronLeft, ChevronRight, Plus } from "lucide-react";

/**
 * SCHEDULE PAGE - Primary operational view (Breezeway pattern)
 *
 * Design brief for designer:
 * - This is the MOST IMPORTANT screen — property x time grid (Gantt-like)
 * - Y-axis: properties, X-axis: dates (week view default, month toggle)
 * - Reservation bars overlaid with task markers
 * - Color-coded: Gray=Scheduled, Blue=Assigned, Yellow=In Progress, Green=Completed, Red=Issues
 * - Drag-and-drop to reschedule jobs
 * - Click job to see details in a slide-over panel
 * - Toggle between: Week view, Month view, Day (timeline per cleaner)
 * - Filter by: property group/tag, cleaner, status
 */
export default function SchedulePage() {
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--accent)]">
            Today
          </button>
          <div className="flex items-center gap-1">
            <button className="rounded-md p-1.5 hover:bg-[var(--accent)]">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button className="rounded-md p-1.5 hover:bg-[var(--accent)]">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <span className="text-sm font-semibold">March 23 – 29, 2026</span>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggles */}
          <div className="flex rounded-md border border-[var(--border)]">
            <button className="bg-[var(--accent)] px-3 py-1.5 text-xs font-medium">
              Week
            </button>
            <button className="px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)]">
              Month
            </button>
            <button className="px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)]">
              Timeline
            </button>
          </div>
          <button className="flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
            <Plus className="h-4 w-4" />
            New Job
          </button>
        </div>
      </div>

      {/* Calendar grid placeholder */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        {/* Day headers */}
        <div className="grid grid-cols-[200px_repeat(7,1fr)] border-b border-[var(--border)]">
          <div className="p-3 text-xs font-medium text-[var(--muted-foreground)]">
            Property
          </div>
          {["Mon 23", "Tue 24", "Wed 25", "Thu 26", "Fri 27", "Sat 28", "Sun 29"].map(
            (day) => (
              <div
                key={day}
                className="border-l border-[var(--border)] p-3 text-center text-xs font-medium text-[var(--muted-foreground)]"
              >
                {day}
              </div>
            ),
          )}
        </div>

        {/* Property rows placeholder */}
        <div className="flex items-center justify-center py-24 text-sm text-[var(--muted-foreground)]">
          <div className="text-center">
            <Calendar className="mx-auto h-8 w-8 mb-2 opacity-40" />
            <p>Schedule view will show properties × dates</p>
            <p className="text-xs mt-1">
              With reservation bars and job markers
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
