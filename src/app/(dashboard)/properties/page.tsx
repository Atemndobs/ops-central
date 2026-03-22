import { Plus, Search, Building2 } from "lucide-react";

/**
 * PROPERTIES PAGE
 *
 * Design brief for designer:
 * - Card grid of properties with status indicators
 * - Each card: photo, name, address, status badge (Ready/Dirty/In Progress/Vacant)
 * - Quick stats on each card: next checkout, next check-in, assigned cleaner
 * - Filter by: status, tag (Airbnb, VRBO, corporate), active/inactive
 * - Click card → property detail page
 * - "Add Property" opens creation modal
 */
export default function PropertiesPage() {
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5">
            <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
            <input
              type="text"
              placeholder="Search properties..."
              className="bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
            />
          </div>
        </div>
        <button className="flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
          <Plus className="h-4 w-4" />
          Add Property
        </button>
      </div>

      {/* Property grid placeholder */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Empty state */}
        <div className="col-span-full flex items-center justify-center rounded-lg border border-dashed border-[var(--border)] py-24">
          <div className="text-center">
            <Building2 className="mx-auto h-8 w-8 mb-2 opacity-40 text-[var(--muted-foreground)]" />
            <p className="text-sm text-[var(--muted-foreground)]">
              Properties will load from Convex
            </p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              Cards with photo, status badge, and quick stats
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
