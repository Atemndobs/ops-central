/**
 * PROPERTY DETAIL PAGE
 *
 * Design brief for designer:
 * - Hero: property photo, name, address, status badge
 * - Tabs: Overview | Jobs | Checklists | Inventory | Settings
 * - Overview: key stats (total jobs, avg cleaning time, quality score, next checkout)
 * - Jobs: filtered job list for this property
 * - Checklists: property-specific checklist templates
 * - Inventory: supplies tracked at this property
 * - Settings: bedrooms/bathrooms, access codes, cleaning duration, tags
 */
export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      {/* Property header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold">Property Detail</h2>
          <p className="text-sm text-[var(--muted-foreground)]">ID: {id}</p>
        </div>
        <button className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--accent)]">
          Edit Property
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {["Overview", "Jobs", "Checklists", "Inventory", "Settings"].map(
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

      {/* Content placeholder */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
        <p className="text-sm text-[var(--muted-foreground)]">
          Property details will load from Convex
        </p>
      </div>
    </div>
  );
}
