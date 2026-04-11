"use client";

import { useTranslations } from "next-intl";
import type { SyncState } from "@/features/cleaner/offline/types";

export function SyncBanner({ syncState }: { syncState: SyncState }) {
  const t = useTranslations();

  if (syncState.pendingCount === 0 && syncState.failedCount === 0 && syncState.isOnline) {
    return null;
  }

  const tone = syncState.failedCount > 0 || !syncState.isOnline
    ? "border-amber-500/60 bg-amber-500/10 text-amber-200"
    : "border-blue-500/60 bg-blue-500/10 text-blue-100";

  return (
    <div className={`rounded-md border p-2 text-xs ${tone}`}>
      {!syncState.isOnline ? (
        <p>{t("cleaner.sync.offline")}</p>
      ) : null}

      {syncState.isSyncing ? <p>{t("cleaner.sync.syncing")}</p> : null}

      {syncState.pendingCount > 0 ? (
        <p>{t("cleaner.sync.pendingUpload", { count: syncState.pendingCount })}</p>
      ) : null}

      {syncState.failedCount > 0 ? (
        <p>{t("cleaner.sync.failedUpload", { count: syncState.failedCount })}</p>
      ) : null}

      {syncState.lastError ? <p>{t("cleaner.sync.lastError", { error: syncState.lastError })}</p> : null}
    </div>
  );
}
