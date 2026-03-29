import type { PendingUpload, SyncState } from "./types";

export function enqueueUpload(
  queue: PendingUpload[],
  upload: PendingUpload,
): PendingUpload[] {
  const existingIndex = queue.findIndex((item) => item.id === upload.id);
  if (existingIndex === -1) {
    return [...queue, upload].sort((a, b) => a.createdAt - b.createdAt);
  }

  const next = [...queue];
  next[existingIndex] = upload;
  return next;
}

export function removeUpload(queue: PendingUpload[], uploadId: string): PendingUpload[] {
  return queue.filter((item) => item.id !== uploadId);
}

export function markUploadSyncing(
  queue: PendingUpload[],
  uploadId: string,
): PendingUpload[] {
  return queue.map((item) =>
    item.id === uploadId
      ? {
          ...item,
          status: "syncing",
          attempts: item.attempts + 1,
          lastError: undefined,
        }
      : item,
  );
}

export function markUploadFailed(
  queue: PendingUpload[],
  uploadId: string,
  errorMessage: string,
): PendingUpload[] {
  return queue.map((item) =>
    item.id === uploadId
      ? {
          ...item,
          status: "failed",
          lastError: errorMessage,
        }
      : item,
  );
}

export function resetFailedUploads(queue: PendingUpload[]): PendingUpload[] {
  return queue.map((item) =>
    item.status === "failed"
      ? {
          ...item,
          status: "pending",
          lastError: undefined,
        }
      : item,
  );
}

export function getNextPendingUploads(
  queue: PendingUpload[],
  batchSize = 1,
): PendingUpload[] {
  const safeBatchSize = Math.max(1, Math.floor(batchSize));
  return queue
    .filter((item) => item.status === "pending")
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, safeBatchSize);
}

export function buildSyncState(args: {
  queue: PendingUpload[];
  isOnline: boolean;
  isSyncing: boolean;
  lastError?: string;
}): SyncState {
  const pendingCount = args.queue.filter(
    (item) => item.status === "pending" || item.status === "syncing",
  ).length;
  const failedCount = args.queue.filter((item) => item.status === "failed").length;
  const queueCount = pendingCount + failedCount;

  return {
    isOnline: args.isOnline,
    isSyncing: args.isSyncing,
    pendingCount,
    failedCount,
    canSubmit: args.isOnline && queueCount === 0 && !args.isSyncing,
    lastError: args.lastError,
  };
}
