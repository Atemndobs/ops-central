import { BarChart3, Download, Mail, FileText } from "lucide-react";

/**
 * REPORTS PAGE
 *
 * Design brief for designer:
 * - Tabs: Operations | Owner Reports | Analytics
 *
 * Operations tab:
 * - Charts: jobs completed (bar), quality trends (line), on-time % (gauge)
 * - Cleaner leaderboard summary
 * - Property health scores
 *
 * Owner Reports tab:
 * - List of properties with "Generate Report" button each
 * - Report preview in modal before sending
 * - PDF download and email-to-owner actions
 * - Monthly auto-report schedule toggle
 *
 * Analytics tab:
 * - Time tracking: actual vs estimated duration
 * - Cost tracking: labor + supplies per property
 * - Quality metrics: inspection pass rate by cleaner and property
 * - Issue frequency heatmap
 */
export default function ReportsPage() {
  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {["Operations", "Owner Reports", "Analytics"].map((tab) => (
          <button
            key={tab}
            className="border-b-2 border-transparent px-4 py-2 text-sm text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]"
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-2">
        <button className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]">
          <Download className="h-4 w-4" />
          Export PDF
        </button>
        <button className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]">
          <Mail className="h-4 w-4" />
          Email to Owner
        </button>
      </div>

      {/* Charts placeholder */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h3 className="text-sm font-semibold mb-4">Jobs Completed</h3>
          <div className="flex items-center justify-center py-16">
            <BarChart3 className="h-8 w-8 opacity-40 text-[var(--muted-foreground)]" />
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h3 className="text-sm font-semibold mb-4">Quality Trends</h3>
          <div className="flex items-center justify-center py-16">
            <BarChart3 className="h-8 w-8 opacity-40 text-[var(--muted-foreground)]" />
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h3 className="text-sm font-semibold mb-4">Property Health Scores</h3>
          <div className="flex items-center justify-center py-16">
            <FileText className="h-8 w-8 opacity-40 text-[var(--muted-foreground)]" />
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h3 className="text-sm font-semibold mb-4">Cost Breakdown</h3>
          <div className="flex items-center justify-center py-16">
            <BarChart3 className="h-8 w-8 opacity-40 text-[var(--muted-foreground)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
