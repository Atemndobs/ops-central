import { Filter, Plus, Search, Wrench } from "lucide-react";

const summary = [
  { label: "Urgent", count: 1, tone: "bg-rose-500" },
  { label: "New", count: 1, tone: "bg-blue-500" },
  { label: "In Progress", count: 0, tone: "bg-amber-500" },
  { label: "Assigned", count: 1, tone: "bg-indigo-500" },
];

export default function WorkOrdersPage() {
  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-micro text-[var(--muted-foreground)]">Maintenance Management</p>
          <h1 className="mt-2 text-display">Work Orders</h1>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 rounded-none bg-[var(--secondary)] px-4 py-2 text-sm font-medium">
            <Filter className="h-4 w-4" />
            Filter
          </button>
          <button className="flex items-center gap-2 rounded-none bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]">
            <Plus className="h-4 w-4" />
            Create Work Order
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {summary.map((item) => (
          <div key={item.label} className="no-line-card flex items-center justify-between border p-4">
            <div>
              <p className="text-micro text-[var(--muted-foreground)]">{item.label}</p>
              <p className="mt-1 text-2xl font-bold">{item.count}</p>
            </div>
            <div className={`h-8 w-1.5 ${item.tone}`} />
          </div>
        ))}
      </div>

      <div className="no-line-card overflow-hidden border">
        <div className="flex items-center justify-between border-b bg-[var(--secondary)]/40 p-6">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              type="text"
              placeholder="Search work orders..."
              className="w-full rounded-none bg-[var(--card)] py-2 pl-10 pr-4 text-sm outline-none"
            />
          </div>
        </div>
        <div className="flex min-h-72 items-center justify-center p-8 text-center">
          <div>
            <Wrench className="mx-auto mb-3 h-8 w-8 text-[var(--muted-foreground)]" />
            <p className="text-sm font-semibold">Work orders will load from Convex</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Created from inspections, incidents, or manual requests.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
