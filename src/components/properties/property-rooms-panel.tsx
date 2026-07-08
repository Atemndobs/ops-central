"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";

type Room = { name: string; type: string };

export function PropertyRoomsPanel({
  propertyId,
  rooms,
  hasHospitableId,
}: {
  propertyId: string;
  rooms: Room[] | null | undefined;
  hasHospitableId: boolean;
}) {
  const { showToast } = useToast();
  const resync = useAction(api.hospitable.actions.resyncPropertyDetails);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleResync = async () => {
    if (!hasHospitableId || isSyncing) return;
    setIsSyncing(true);
    try {
      const result = await resync({ propertyId: propertyId as Id<"properties"> });
      showToast(`Resynced ${result.roomsSynced} room(s) from Hospitable.`);
    } catch (error) {
      showToast(getErrorMessage(error, "Failed to resync rooms."), "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const roomList = rooms ?? [];

  return (
    <section className="rounded-2xl border bg-[var(--card)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
            Rooms
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            {roomList.length > 0
              ? `${roomList.length} room${roomList.length === 1 ? "" : "s"} · synced from Hospitable`
              : "Source of truth for checklist + incident dropdowns."}
          </p>
        </div>
        <button
          type="button"
          onClick={handleResync}
          disabled={!hasHospitableId || isSyncing}
          title={
            !hasHospitableId
              ? "Property has no Hospitable ID — cannot resync."
              : "Fetch latest rooms from Hospitable."
          }
          className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSyncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {isSyncing ? "Resyncing…" : "Resync from Hospitable"}
        </button>
      </div>

      <div className="px-4 py-4">
        {roomList.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            {hasHospitableId
              ? "No rooms synced yet. Click resync to pull the latest list from Hospitable."
              : "This property has no Hospitable ID. Rooms must be set manually in Hospitable and resynced."}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {roomList.map((room, index) => (
              <li
                key={`${room.name}-${index}`}
                className="inline-flex items-center gap-2 rounded-full border bg-[var(--background)] px-3 py-1.5 text-sm"
              >
                <span className="font-medium">{room.name}</span>
                <span className="text-xs text-[var(--muted-foreground)]">
                  {room.type.replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
