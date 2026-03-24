import { Award, Download, Target, TrendingUp } from "lucide-react";

export default function ReportsPage() {
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-display">Reports</h1>
          <p className="mt-2 text-[var(--muted-foreground)]">
            Analyze performance and quality metrics across your portfolio.
          </p>
        </div>
        <button className="flex items-center gap-2 rounded-none bg-[var(--primary)] px-6 py-3 text-sm font-black uppercase tracking-widest text-[var(--primary-foreground)]">
          <Download className="h-4 w-4" />
          Export Data
        </button>
      </div>

      <div className="grid gap-8 md:grid-cols-3">
        <article className="no-line-card border p-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center border border-[var(--primary)]/30 bg-[var(--primary)]/10">
            <TrendingUp className="h-6 w-6 text-[var(--primary)]" />
          </div>
          <h2 className="text-lg font-black uppercase">Efficiency Report</h2>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            Track time-to-completion and on-time performance trends.
          </p>
        </article>

        <article className="no-line-card border p-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center border border-emerald-300 bg-emerald-100">
            <Target className="h-6 w-6 text-emerald-700" />
          </div>
          <h2 className="text-lg font-black uppercase">Quality Metrics</h2>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            Analyze inspection results and guest feedback scores.
          </p>
        </article>

        <article className="no-line-card border p-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center border border-rose-300 bg-rose-100">
            <Award className="h-6 w-6 text-rose-700" />
          </div>
          <h2 className="text-lg font-black uppercase">Team Rankings</h2>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            Compare individual performance and reward top cleaners.
          </p>
        </article>
      </div>
    </div>
  );
}
