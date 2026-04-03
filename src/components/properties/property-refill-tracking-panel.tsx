"use client";

import { useEffect, useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";

type InventoryItemRow = {
  _id: Id<"inventoryItems">;
  name: string;
  room?: string;
  isRefillTracked?: boolean;
  refillLowThresholdPct?: number;
  refillCriticalThresholdPct?: number;
  status: "ok" | "low_stock" | "out_of_stock" | "reorder_pending";
};

type QueueItemRow = {
  _id: Id<"refillQueue">;
  itemId: Id<"inventoryItems">;
  status: "open" | "acknowledged" | "ordered" | "resolved";
  level: "low" | "critical" | "out";
  lastPercentRemaining: number;
  note?: string;
  updatedAt?: number;
  createdAt: number;
  item?: { _id: Id<"inventoryItems">; name: string; room?: string } | null;
};

type RefillDraft = {
  tracked: boolean;
  low: number;
  critical: number;
};

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function queueLevelClass(level: QueueItemRow["level"]) {
  if (level === "out") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (level === "critical") {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function PropertyRefillTrackingPanel({
  propertyId,
}: {
  propertyId: string;
}) {
  const { isAuthenticated } = useConvexAuth();
  const { showToast } = useToast();

  const inventoryItems = useQuery(
    api.inventory.queries.getAll,
    isAuthenticated
      ? {
          propertyId: propertyId as Id<"properties">,
        }
      : "skip",
  ) as InventoryItemRow[] | undefined;

  const refillQueue = useQuery(
    api.refills.queries.getQueue,
    isAuthenticated
      ? {
          propertyId: propertyId as Id<"properties">,
          limit: 100,
        }
      : "skip",
  ) as QueueItemRow[] | undefined;

  const setTrackingConfig = useMutation(api.refills.mutations.setTrackingConfig);
  const updateQueueStatus = useMutation(api.refills.mutations.updateQueueStatus);

  const [drafts, setDrafts] = useState<Record<string, RefillDraft>>({});
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [pendingQueueId, setPendingQueueId] = useState<string | null>(null);

  useEffect(() => {
    if (!inventoryItems) {
      return;
    }

    setDrafts((previous) => {
      const next = { ...previous };
      inventoryItems.forEach((item) => {
        if (!next[item._id]) {
          next[item._id] = {
            tracked: item.isRefillTracked === true,
            low: clampPercent(item.refillLowThresholdPct ?? 50),
            critical: clampPercent(item.refillCriticalThresholdPct ?? 20),
          };
        }
      });
      return next;
    });
  }, [inventoryItems]);

  const activeQueue = useMemo(
    () =>
      (refillQueue ?? [])
        .filter((row) => row.status !== "resolved")
        .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)),
    [refillQueue],
  );

  const trackedCount = useMemo(
    () => (inventoryItems ?? []).filter((item) => item.isRefillTracked === true).length,
    [inventoryItems],
  );

  async function saveRow(item: InventoryItemRow) {
    const draft = drafts[item._id];
    if (!draft) {
      return;
    }

    const low = clampPercent(draft.low);
    const critical = clampPercent(draft.critical);
    if (critical > low) {
      showToast("Critical threshold cannot be greater than low threshold.", "error");
      return;
    }

    setPendingItemId(item._id);
    try {
      await setTrackingConfig({
        itemId: item._id,
        isRefillTracked: draft.tracked,
        refillLowThresholdPct: low,
        refillCriticalThresholdPct: critical,
      });
      showToast("Refill settings updated.");
    } catch (mutationError) {
      showToast(getErrorMessage(mutationError, "Failed to update refill settings."), "error");
    } finally {
      setPendingItemId(null);
    }
  }

  async function setQueueRowStatus(
    queueId: Id<"refillQueue">,
    status: "open" | "acknowledged" | "ordered" | "resolved",
  ) {
    setPendingQueueId(queueId);
    try {
      await updateQueueStatus({ queueId, status });
      showToast("Refill queue status updated.");
    } catch (mutationError) {
      showToast(getErrorMessage(mutationError, "Failed to update refill queue status."), "error");
    } finally {
      setPendingQueueId(null);
    }
  }

  return (
    <section className="rounded-2xl border bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            Refill Tracking
          </h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Track percent-remaining thresholds for consumables and monitor open refill queue alerts.
          </p>
        </div>
        <span className="rounded-full border px-2 py-1 text-xs text-[var(--muted-foreground)]">
          {trackedCount} tracked
        </span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[760px]">
          <thead className="bg-[var(--secondary)]">
            <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-center">Track</th>
              <th className="px-3 py-2 text-center">Low %</th>
              <th className="px-3 py-2 text-center">Critical %</th>
              <th className="px-3 py-2">Inventory Status</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {inventoryItems === undefined ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-[var(--muted-foreground)]">
                  Loading refill items...
                </td>
              </tr>
            ) : inventoryItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-[var(--muted-foreground)]">
                  No inventory items found for this property.
                </td>
              </tr>
            ) : (
              inventoryItems.map((item) => {
                const draft = drafts[item._id] ?? {
                  tracked: item.isRefillTracked === true,
                  low: clampPercent(item.refillLowThresholdPct ?? 50),
                  critical: clampPercent(item.refillCriticalThresholdPct ?? 20),
                };
                return (
                  <tr key={item._id} className="border-t">
                    <td className="px-3 py-2 text-sm">
                      <p className="font-semibold">{item.name}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">{item.room || "General"}</p>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={draft.tracked}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [item._id]: {
                              ...draft,
                              tracked: event.target.checked,
                            },
                          }))
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={draft.low}
                        onChange={(event) => {
                          const next = clampPercent(Number(event.target.value));
                          setDrafts((prev) => ({
                            ...prev,
                            [item._id]: {
                              ...draft,
                              low: next,
                            },
                          }));
                        }}
                        className="w-20 rounded border bg-[var(--card)] px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={draft.critical}
                        onChange={(event) => {
                          const next = clampPercent(Number(event.target.value));
                          setDrafts((prev) => ({
                            ...prev,
                            [item._id]: {
                              ...draft,
                              critical: next,
                            },
                          }));
                        }}
                        className="w-20 rounded border bg-[var(--card)] px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
                      {item.status.replace(/_/g, " ")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => saveRow(item)}
                        disabled={pendingItemId === item._id}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-[var(--accent)] disabled:opacity-60"
                      >
                        {pendingItemId === item._id ? "Saving..." : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 rounded-xl border p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Active Refill Queue ({activeQueue.length})
        </p>
        {refillQueue === undefined ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading queue...</p>
        ) : activeQueue.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No active refill alerts.</p>
        ) : (
          <div className="space-y-2">
            {activeQueue.map((row) => (
              <div
                key={row._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] px-2 py-2 text-xs"
              >
                <div>
                  <p className="font-semibold">
                    {row.item?.room ? `${row.item.room}: ` : ""}
                    {row.item?.name ?? row.itemId}
                  </p>
                  <p className="text-[var(--muted-foreground)]">
                    {Math.round(row.lastPercentRemaining)}% remaining · {row.status}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 font-semibold uppercase ${queueLevelClass(row.level)}`}
                  >
                    {row.level}
                  </span>
                  <select
                    value={row.status}
                    disabled={pendingQueueId === row._id}
                    onChange={(event) =>
                      setQueueRowStatus(
                        row._id,
                        event.target.value as QueueItemRow["status"],
                      )
                    }
                    className="rounded border bg-[var(--card)] px-2 py-1"
                  >
                    <option value="open">Open</option>
                    <option value="acknowledged">Acknowledged</option>
                    <option value="ordered">Ordered</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
