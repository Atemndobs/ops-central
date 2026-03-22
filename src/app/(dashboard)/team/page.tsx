import { Plus, Search, Users } from "lucide-react";

/**
 * TEAM PAGE - Cleaner and staff management
 *
 * Design brief for designer:
 * - Card grid of team members (photo, name, role, performance stats)
 * - Each card: jobs completed this month, quality score %, on-time %
 * - Mini availability indicator (available today / busy / off)
 * - Filter by role (cleaner, manager, ops)
 * - Click card → team member detail page
 * - Leaderboard tab: ranked by performance (gamification)
 * - Availability tab: weekly grid showing who's available when
 */
export default function TeamPage() {
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1.5">
            <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
            <input
              type="text"
              placeholder="Search team..."
              className="bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
            />
          </div>
        </div>
        <button className="flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
          <Plus className="h-4 w-4" />
          Invite Member
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {["All Members", "Leaderboard", "Availability"].map((tab) => (
          <button
            key={tab}
            className="border-b-2 border-transparent px-4 py-2 text-sm text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]"
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Team grid placeholder */}
      <div className="flex items-center justify-center rounded-lg border border-dashed border-[var(--border)] py-24">
        <div className="text-center">
          <Users className="mx-auto h-8 w-8 mb-2 opacity-40 text-[var(--muted-foreground)]" />
          <p className="text-sm text-[var(--muted-foreground)]">
            Team members will load from Convex
          </p>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">
            Cards with photo, role, and performance metrics
          </p>
        </div>
      </div>
    </div>
  );
}
