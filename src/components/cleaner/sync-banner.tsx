"use client";

import type { SyncState } from "@/features/cleaner/offline/types";

export function SyncBanner({ syncState }: { syncState: SyncState }) {
  if (syncState.pendingCount === 0 && syncState.failedCount === 0 && syncState.isOnline) {
    return null;
  }

  const tone = syncState.failedCount > 0 || !syncState.isOnline
    ? "border-amber-500/60 bg-amber-500/10 text-amber-200"
    : "border-blue-500/60 bg-blue-500/10 text-blue-100";

  return (
    <div className={`rounded-md border p-2 text-xs ${tone}`}>
      {!syncState.isOnline ? (
        <p>You are offline. Photos and progress are being saved locally.</p>
      ) : null}

      {syncState.isSyncing ? <p>Sync in progress...</p> : null}

      {syncState.pendingCount > 0 ? (
        <p>
          {syncState.pendingCount} pending upload{syncState.pendingCount > 1 ? "s" : ""}.
        </p>
      ) : null}

      {syncState.failedCount > 0 ? (
        <p>
          {syncState.failedCount} failed upload{syncState.failedCount > 1 ? "s" : ""}. Retry by going online.
        </p>
      ) : null}

      {syncState.lastError ? <p>Last sync error: {syncState.lastError}</p> : null}
    </div>
  );
}
