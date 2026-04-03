"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { AlertTriangle, Loader2, Plus, Search } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";

type InventoryStatus = "ok" | "low_stock" | "out_of_stock" | "reorder_pending";

type InventoryItem = {
  _id: string;
  name: string;
  room?: string;
  status: InventoryStatus;
  quantityCurrent: number;
  minimumQuantity: number;
  property?: { id: string; name: string } | null;
  category?: { id: string; name: string } | null;
};

type RefillQueueRow = {
  _id: Id<"refillQueue">;
  status: "open" | "acknowledged" | "ordered" | "resolved";
  level: "low" | "critical" | "out";
  lastPercentRemaining: number;
  updatedAt?: number;
  createdAt: number;
  property?: { _id: Id<"properties">; name: string } | null;
  item?: { _id: Id<"inventoryItems">; name: string; room?: string } | null;
};

const statusLabel: Record<InventoryStatus, string> = {
  ok: "In Stock",
  low_stock: "Low Stock",
  out_of_stock: "Out of Stock",
  reorder_pending: "Reorder Pending",
};

const statusClass: Record<InventoryStatus, string> = {
  ok: "bg-emerald-100 text-emerald-700 border-emerald-200",
  low_stock: "bg-amber-100 text-amber-700 border-amber-200",
  out_of_stock: "bg-rose-100 text-rose-700 border-rose-200",
  reorder_pending: "bg-blue-100 text-blue-700 border-blue-200",
};

export default function InventoryPage() {
  const [search, setSearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | InventoryStatus>("all");
  const { isAuthenticated } = useConvexAuth();
  const { showToast } = useToast();
  const [pendingQueueId, setPendingQueueId] = useState<string | null>(null);

  const inventory = useQuery(
    api.inventory.queries.getAll,
    isAuthenticated
      ? {
          propertyId: propertyFilter === "all" ? undefined : (propertyFilter as never),
          status: statusFilter === "all" ? undefined : statusFilter,
        }
      : "skip",
  );

  const lowStock = useQuery(
    api.inventory.queries.getLowStock,
    isAuthenticated ? {} : "skip",
  );
  const globalStats = useQuery(
    api.inventory.queries.getGlobalStats,
    isAuthenticated ? {} : "skip",
  );
  const properties = useQuery(
    api.properties.queries.getAll,
    isAuthenticated ? { limit: 500 } : "skip",
  );
  const refillQueue = useQuery(
    api.refills.queries.getQueue,
    isAuthenticated ? { limit: 200 } : "skip",
  ) as RefillQueueRow[] | undefined;
  const updateQueueStatus = useMutation(api.refills.mutations.updateQueueStatus);

  const filteredItems = useMemo(() => {
    const items = (inventory ?? []) as InventoryItem[];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item: InventoryItem) => {
      return (
        item.name.toLowerCase().includes(q) ||
        item.property?.name?.toLowerCase().includes(q) ||
        item.category?.name?.toLowerCase().includes(q) ||
        item.room?.toLowerCase().includes(q)
      );
    });
  }, [inventory, search]);

  const loading = isAuthenticated && (!inventory || !lowStock || !globalStats || !properties);
  const activeRefillQueue = useMemo(
    () =>
      (refillQueue ?? [])
        .filter((row) => row.status !== "resolved")
        .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)),
    [refillQueue],
  );

  async function handleQueueStatusChange(
    queueId: Id<"refillQueue">,
    status: "open" | "acknowledged" | "ordered" | "resolved",
  ) {
    setPendingQueueId(queueId);
    try {
      await updateQueueStatus({ queueId, status });
      showToast("Refill queue item updated.");
    } catch (mutationError) {
      showToast(getErrorMessage(mutationError, "Failed to update refill queue item."), "error");
    } finally {
      setPendingQueueId(null);
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-2xl border bg-[var(--card)] text-[var(--muted-foreground)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Inventory Management</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Monitor stock levels across properties and identify restock risks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-xl bg-[var(--secondary)] px-4 py-2 text-sm font-semibold text-[var(--secondary-foreground)]">
            Export CSV
          </button>
          <button className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)]">
            <Plus className="h-4 w-4" />
            Add New Item
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <QuickCard label="Total SKU Items" value={globalStats?.totalItems} hint="Tracked inventory items" />
        <QuickCard label="Low Stock Alerts" value={globalStats?.lowStockCount} hint="Action required" tone="warning" />
        <QuickCard label="Needs Restock" value={globalStats?.outOfStockCount} hint="Marked for replenishment" tone="danger" />
        <QuickCard label="Categories" value={globalStats?.categoriesCount} hint="Inventory categories" />
      </div>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center rounded-2xl border bg-[var(--card)] text-[var(--muted-foreground)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading inventory...
        </div>
      ) : (
        <>
          {lowStock!.length > 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="text-sm text-amber-800">
                {lowStock!.length} items are below par level and need restocking.
              </span>
            </div>
          ) : null}

          <section className="rounded-2xl border bg-[var(--card)]">
            <div className="flex items-center justify-between gap-2 border-b p-4">
              <h2 className="text-lg font-bold">Refill Queue</h2>
              <span className="rounded-full border px-2 py-1 text-xs text-[var(--muted-foreground)]">
                {activeRefillQueue.length} active
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="bg-[var(--secondary)]">
                  <tr className="text-left text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                    <th className="px-4 py-3">Property</th>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Level</th>
                    <th className="px-4 py-3 text-center">Remaining</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Update</th>
                  </tr>
                </thead>
                <tbody>
                  {refillQueue === undefined ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]"
                      >
                        Loading refill queue...
                      </td>
                    </tr>
                  ) : activeRefillQueue.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]"
                      >
                        No active refill alerts.
                      </td>
                    </tr>
                  ) : (
                    activeRefillQueue.map((row) => (
                      <tr key={row._id} className="border-t">
                        <td className="px-4 py-3 text-sm">{row.property?.name ?? "Unknown"}</td>
                        <td className="px-4 py-3 text-sm">
                          {row.item?.room ? `${row.item.room}: ` : ""}
                          {row.item?.name ?? "Unknown item"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${
                              row.level === "out"
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : row.level === "critical"
                                  ? "border-orange-200 bg-orange-50 text-orange-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700"
                            }`}
                          >
                            {row.level}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-semibold">
                          {Math.round(row.lastPercentRemaining)}%
                        </td>
                        <td className="px-4 py-3 text-sm capitalize">
                          {row.status.replace("_", " ")}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <select
                            value={row.status}
                            disabled={pendingQueueId === row._id}
                            onChange={(event) =>
                              handleQueueStatusChange(
                                row._id,
                                event.target.value as RefillQueueRow["status"],
                              )
                            }
                            className="rounded-md border bg-[var(--card)] px-2 py-1.5 text-sm"
                          >
                            <option value="open">Open</option>
                            <option value="acknowledged">Acknowledged</option>
                            <option value="ordered">Ordered</option>
                            <option value="resolved">Resolved</option>
                          </select>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border bg-[var(--card)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
              <h2 className="text-lg font-bold">Main Inventory List</h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
                  <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search inventory"
                    className="w-44 bg-transparent text-sm outline-none"
                  />
                </div>
                <select
                  value={propertyFilter}
                  onChange={(event) => setPropertyFilter(event.target.value)}
                  className="rounded-md border bg-[var(--card)] px-2 py-1.5 text-sm"
                >
                  <option value="all">All Properties</option>
                  {properties!.map((property) => (
                    <option key={property._id} value={property._id}>
                      {property.name}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                  className="rounded-md border bg-[var(--card)] px-2 py-1.5 text-sm"
                >
                  <option value="all">All Statuses</option>
                  {Object.entries(statusLabel).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead className="bg-[var(--secondary)]">
                  <tr className="text-left text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Property</th>
                    <th className="px-4 py-3 text-center">Current</th>
                    <th className="px-4 py-3 text-center">Par</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                        No inventory items match this filter.
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item: InventoryItem) => (
                      <tr key={item._id} className="border-t">
                        <td className="px-4 py-3">
                          <p className="text-sm font-semibold">{item.name}</p>
                          <p className="text-xs text-[var(--muted-foreground)]">{item.room || "General"}</p>
                        </td>
                        <td className="px-4 py-3 text-sm">{item.category?.name || "Uncategorized"}</td>
                        <td className="px-4 py-3 text-sm">{item.property?.name || "Unknown"}</td>
                        <td className="px-4 py-3 text-center text-sm font-semibold">{item.quantityCurrent}</td>
                        <td className="px-4 py-3 text-center text-sm text-[var(--muted-foreground)]">{item.minimumQuantity}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass[item.status as InventoryStatus] ?? ""}`}>
                            {statusLabel[item.status as InventoryStatus] ?? item.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function QuickCard({
  label,
  value,
  hint,
  suffix,
  tone = "default",
}: {
  label: string;
  value?: number;
  hint: string;
  suffix?: string;
  tone?: "default" | "warning" | "danger";
}) {
  const toneClass =
    tone === "warning"
      ? "text-amber-700"
      : tone === "danger"
        ? "text-rose-700"
        : "text-[var(--foreground)]";

  return (
    <div className="rounded-2xl border bg-[var(--card)] p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      <p className={`mt-2 text-4xl font-extrabold leading-none ${toneClass}`}>
        {value ?? "-"}
        {suffix || ""}
      </p>
      <p className="mt-2 text-xs text-[var(--muted-foreground)]">{hint}</p>
    </div>
  );
}
