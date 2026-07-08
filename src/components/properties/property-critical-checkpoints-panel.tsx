"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import { useToast } from "@/components/ui/toast-provider";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { getErrorMessage } from "@/lib/errors";

type InventoryItemOption = {
  _id: Id<"inventoryItems">;
  name: string;
  room?: string;
  categoryName?: string | null;
};

type CheckpointRow = {
  _id: Id<"propertyCriticalCheckpoints">;
  roomName: string;
  title: string;
  instruction?: string;
  referenceImageUrl?: string;
  referenceUrl?: string | null;
  linkedInventoryItemId?: Id<"inventoryItems">;
  isRequired: boolean;
  isActive: boolean;
  sortOrder: number;
};

type NewCheckpointDraft = {
  roomName: string;
  title: string;
  instruction: string;
  referenceImageUrl: string;
  linkedInventoryItemId: string;
  isRequired: boolean;
};

function defaultDraft(): NewCheckpointDraft {
  return {
    roomName: "",
    title: "",
    instruction: "",
    referenceImageUrl: "",
    linkedInventoryItemId: "",
    isRequired: true,
  };
}

export function PropertyCriticalCheckpointsPanel({
  propertyId,
  propertyRooms,
}: {
  propertyId: string;
  propertyRooms?: Array<{ name: string; type?: string }>;
}) {
  const { isAuthenticated } = useConvexAuth();
  const { showToast } = useToast();

  const checkpoints = useQuery(
    api.propertyChecks.queries.getByProperty,
    isAuthenticated
      ? {
          propertyId: propertyId as Id<"properties">,
          includeInactive: true,
        }
      : "skip",
  ) as CheckpointRow[] | undefined;

  const inventoryItems = useQuery(
    api.inventory.queries.getAll,
    isAuthenticated
      ? {
          propertyId: propertyId as Id<"properties">,
        }
      : "skip",
  ) as InventoryItemOption[] | undefined;

  const createCheckpoint = useMutation(api.propertyChecks.mutations.create);
  const updateCheckpoint = useMutation(api.propertyChecks.mutations.update);
  const removeCheckpoint = useMutation(api.propertyChecks.mutations.remove);
  const setCheckpointActive = useMutation(api.propertyChecks.mutations.setActive);

  const [draft, setDraft] = useState<NewCheckpointDraft>(defaultDraft);
  const [itemCategoryFilter, setItemCategoryFilter] = useState<string>("all");
  const [isSaving, setIsSaving] = useState(false);
  const [pendingCheckpointId, setPendingCheckpointId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groupedByRoom = useMemo(() => {
    const rows = checkpoints ?? [];
    return rows.reduce<Record<string, CheckpointRow[]>>((acc, row) => {
      const room = row.roomName.trim() || "Unspecified";
      if (!acc[room]) {
        acc[room] = [];
      }
      acc[room].push(row);
      return acc;
    }, {});
  }, [checkpoints]);

  const roomSuggestions = useMemo(() => {
    const fromProperty = (propertyRooms ?? []).map((r) => r.name.trim()).filter(Boolean);
    const fromCheckpoints = Object.keys(groupedByRoom);
    return Array.from(new Set([...fromProperty, ...fromCheckpoints])).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [propertyRooms, groupedByRoom]);

  const roomFamily = useMemo(() => {
    const propertyRoomByName = new Map<string, string>();
    for (const r of propertyRooms ?? []) {
      const name = r.name?.trim().toLowerCase();
      const type = r.type?.trim().toLowerCase();
      if (name && type) {
        propertyRoomByName.set(name, type.replace(/^full_/, "").replace(/_/g, " "));
      }
    }
    return (raw: string | undefined | null): string => {
      if (!raw) return "";
      const lower = raw.trim().toLowerCase();
      if (!lower) return "";
      const byProperty = propertyRoomByName.get(lower);
      if (byProperty) return byProperty;
      // Strip "all ", trailing numbers, and plurals.
      return lower
        .replace(/^all\s+/, "")
        .replace(/\s*\d+$/, "")
        .replace(/s$/, "")
        .trim();
    };
  }, [propertyRooms]);

  const itemCategoryOptions = useMemo(() => {
    const names = new Set<string>();
    for (const item of inventoryItems ?? []) {
      if (item.categoryName) names.add(item.categoryName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [inventoryItems]);

  const filteredInventoryItems = useMemo(() => {
    let items = inventoryItems ?? [];
    if (itemCategoryFilter !== "all") {
      items = items.filter((item) => (item.categoryName ?? "") === itemCategoryFilter);
    }
    const draftFamily = roomFamily(draft.roomName);
    if (draftFamily) {
      items = items.filter((item) => roomFamily(item.room) === draftFamily);
    }
    return items;
  }, [inventoryItems, itemCategoryFilter, draft.roomName, roomFamily]);

  const roomNames = useMemo(
    () => Object.keys(groupedByRoom).sort((a, b) => a.localeCompare(b)),
    [groupedByRoom],
  );

  async function handleCreate() {
    if (!draft.roomName.trim() || !draft.title.trim()) {
      setError("Room and title are required for a checkpoint.");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await createCheckpoint({
        propertyId: propertyId as Id<"properties">,
        roomName: draft.roomName.trim(),
        title: draft.title.trim(),
        instruction: draft.instruction.trim() || undefined,
        referenceImageUrl: draft.referenceImageUrl.trim() || undefined,
        linkedInventoryItemId: draft.linkedInventoryItemId
          ? (draft.linkedInventoryItemId as Id<"inventoryItems">)
          : undefined,
        isRequired: draft.isRequired,
      });
      setDraft(defaultDraft());
      showToast("Checkpoint added.");
    } catch (mutationError) {
      const message = getErrorMessage(mutationError, "Failed to create checkpoint.");
      setError(message);
      showToast(message, "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleRequired(checkpoint: CheckpointRow, isRequired: boolean) {
    setPendingCheckpointId(checkpoint._id);
    try {
      await updateCheckpoint({
        checkpointId: checkpoint._id,
        isRequired,
      });
      showToast("Checkpoint requirement updated.");
    } catch (mutationError) {
      showToast(getErrorMessage(mutationError, "Failed to update checkpoint."), "error");
    } finally {
      setPendingCheckpointId(null);
    }
  }

  async function handleToggleActive(checkpoint: CheckpointRow, isActive: boolean) {
    setPendingCheckpointId(checkpoint._id);
    try {
      await setCheckpointActive({
        checkpointId: checkpoint._id,
        isActive,
      });
      showToast("Checkpoint status updated.");
    } catch (mutationError) {
      showToast(getErrorMessage(mutationError, "Failed to update checkpoint status."), "error");
    } finally {
      setPendingCheckpointId(null);
    }
  }

  async function handleDelete(checkpointId: Id<"propertyCriticalCheckpoints">) {
    const confirmDelete = window.confirm(
      "Delete this checkpoint? This will remove it from future cleaning check flows.",
    );
    if (!confirmDelete) {
      return;
    }

    setPendingCheckpointId(checkpointId);
    try {
      await removeCheckpoint({ checkpointId });
      showToast("Checkpoint removed.");
    } catch (mutationError) {
      showToast(getErrorMessage(mutationError, "Failed to remove checkpoint."), "error");
    } finally {
      setPendingCheckpointId(null);
    }
  }

  return (
    <section className="rounded-2xl border bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            Critical Checkpoints
          </h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Configure room-based critical inventory verification points for every clean.
          </p>
        </div>
        <span className="rounded-full border px-2 py-1 text-xs text-[var(--muted-foreground)]">
          {(checkpoints ?? []).length} total
        </span>
      </div>

      <div className="mt-4 rounded-xl border p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Add Checkpoint
        </p>
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          <input
            list={`room-suggestions-${propertyId}`}
            value={draft.roomName}
            onChange={(event) => setDraft((prev) => ({ ...prev, roomName: event.target.value }))}
            placeholder="Room (e.g. Kitchen)"
            className="rounded-md border bg-[var(--card)] px-2 py-1.5 text-sm"
          />
          <datalist id={`room-suggestions-${propertyId}`}>
            {roomSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <input
            value={draft.title}
            onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="Checkpoint title"
            className="rounded-md border bg-[var(--card)] px-2 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <select
              value={itemCategoryFilter}
              onChange={(event) => setItemCategoryFilter(event.target.value)}
              className="w-32 shrink-0 rounded-md border bg-[var(--card)] px-2 py-1.5 text-sm"
              aria-label="Filter items by category"
            >
              <option value="all">All categories</option>
              {itemCategoryOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <div className="min-w-0 flex-1">
              <SearchableSelect
                value={draft.linkedInventoryItemId || null}
                onChange={(id) =>
                  setDraft((prev) => ({ ...prev, linkedInventoryItemId: id ?? "" }))
                }
                placeholder={
                  filteredInventoryItems.length > 0
                    ? `Link inventory item (optional) — ${filteredInventoryItems.length} available`
                    : "Link inventory item (optional)"
                }
                searchPlaceholder="Search inventory…"
                aria-label="Link inventory item"
                items={filteredInventoryItems.map((item) => ({
                  id: item._id,
                  label: item.name,
                  group: item.room || "Ungrouped",
                  hint: item.categoryName ?? undefined,
                }))}
              />
            </div>
          </div>
          <input
            value={draft.referenceImageUrl}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, referenceImageUrl: event.target.value }))
            }
            placeholder="Reference image URL (optional)"
            className="rounded-md border bg-[var(--card)] px-2 py-1.5 text-sm md:col-span-2"
          />
          <input
            value={draft.instruction}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, instruction: event.target.value }))
            }
            placeholder="What cleaner must verify"
            className="rounded-md border bg-[var(--card)] px-2 py-1.5 text-sm md:col-span-2 lg:col-span-1"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={draft.isRequired}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, isRequired: event.target.checked }))
              }
            />
            Required for submission
          </label>
          <button
            type="button"
            onClick={handleCreate}
            disabled={isSaving}
            className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Add checkpoint"}
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-[var(--destructive)]">{error}</p> : null}
      </div>

      <div className="mt-4 space-y-3">
        {checkpoints === undefined ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading checkpoints...</p>
        ) : checkpoints.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No checkpoints configured yet.
          </p>
        ) : (
          roomNames.map((roomName) => (
            <div key={roomName} className="rounded-xl border p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {roomName}
              </p>
              <div className="space-y-2">
                {(groupedByRoom[roomName] ?? []).map((checkpoint) => (
                  <div
                    key={checkpoint._id}
                    className="rounded-md border border-[var(--border)] px-2 py-2"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{checkpoint.title}</p>
                        {checkpoint.instruction ? (
                          <p className="text-xs text-[var(--muted-foreground)]">
                            {checkpoint.instruction}
                          </p>
                        ) : null}
                        {checkpoint.referenceUrl || checkpoint.referenceImageUrl ? (
                          <a
                            href={checkpoint.referenceUrl ?? checkpoint.referenceImageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-[var(--primary)] hover:underline"
                          >
                            View reference image
                          </a>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDelete(checkpoint._id)}
                        disabled={pendingCheckpointId === checkpoint._id}
                        className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-[var(--muted-foreground)]">
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={checkpoint.isRequired}
                          disabled={pendingCheckpointId === checkpoint._id}
                          onChange={(event) =>
                            handleToggleRequired(checkpoint, event.target.checked)
                          }
                        />
                        Required
                      </label>
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={checkpoint.isActive}
                          disabled={pendingCheckpointId === checkpoint._id}
                          onChange={(event) =>
                            handleToggleActive(checkpoint, event.target.checked)
                          }
                        />
                        Active
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
