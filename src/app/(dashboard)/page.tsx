import {
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Building2,
  Users,
} from "lucide-react";

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--muted-foreground)]">{label}</span>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Good morning, Atem
        </h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Here&apos;s what&apos;s happening with your properties today.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Today's Jobs"
          value="—"
          icon={ClipboardList}
          color="text-[var(--primary)]"
        />
        <StatCard
          label="In Progress"
          value="—"
          icon={Clock}
          color="text-[var(--warning)]"
        />
        <StatCard
          label="Completed Today"
          value="—"
          icon={CheckCircle2}
          color="text-[var(--success)]"
        />
        <StatCard
          label="Needs Attention"
          value="—"
          icon={AlertTriangle}
          color="text-[var(--destructive)]"
        />
      </div>

      {/* Property readiness + upcoming jobs */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Property Readiness - Breezeway's north star metric */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="h-4 w-4 text-[var(--muted-foreground)]" />
            <h3 className="text-sm font-semibold">Property Readiness</h3>
          </div>
          <div className="flex items-center justify-center py-12 text-sm text-[var(--muted-foreground)]">
            Connect to Convex to see property status
          </div>
        </div>

        {/* Team Activity */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-[var(--muted-foreground)]" />
            <h3 className="text-sm font-semibold">Team Activity</h3>
          </div>
          <div className="flex items-center justify-center py-12 text-sm text-[var(--muted-foreground)]">
            Connect to Convex to see team status
          </div>
        </div>
      </div>
    </div>
  );
}
