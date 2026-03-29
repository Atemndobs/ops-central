import type { DraftProgress, PendingUpload } from "./types";

const DB_NAME = "opscentral-cleaner-offline";
const DB_VERSION = 1;
const PENDING_UPLOADS_STORE = "pendingUploads";
const DRAFT_PROGRESS_STORE = "draftProgress";

let cachedDbPromise: Promise<IDBDatabase> | null = null;

export function isIndexedDbSupported(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase> {
  if (!isIndexedDbSupported()) {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }

  if (cachedDbPromise) {
    return cachedDbPromise;
  }

  cachedDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open IndexedDB."));
    };

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(PENDING_UPLOADS_STORE)) {
        db.createObjectStore(PENDING_UPLOADS_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(DRAFT_PROGRESS_STORE)) {
        db.createObjectStore(DRAFT_PROGRESS_STORE, { keyPath: "jobId" });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });

  return cachedDbPromise;
}

function runTransaction<T>(args: {
  storeName: string;
  mode: IDBTransactionMode;
  run: (store: IDBObjectStore) => IDBRequest;
}): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(args.storeName, args.mode);
        const store = tx.objectStore(args.storeName);
        const request = args.run(store);

        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
        request.onsuccess = () => resolve(request.result as T);
      }),
  );
}

export async function listPendingUploads(): Promise<PendingUpload[]> {
  if (!isIndexedDbSupported()) {
    return [];
  }

  const uploads = await runTransaction<PendingUpload[]>({
    storeName: PENDING_UPLOADS_STORE,
    mode: "readonly",
    run: (store) => store.getAll(),
  });

  return uploads.sort((a, b) => a.createdAt - b.createdAt);
}

export async function upsertPendingUpload(upload: PendingUpload): Promise<void> {
  if (!isIndexedDbSupported()) {
    return;
  }

  await runTransaction<unknown>({
    storeName: PENDING_UPLOADS_STORE,
    mode: "readwrite",
    run: (store) => store.put(upload),
  });
}

export async function deletePendingUpload(uploadId: string): Promise<void> {
  if (!isIndexedDbSupported()) {
    return;
  }

  await runTransaction<unknown>({
    storeName: PENDING_UPLOADS_STORE,
    mode: "readwrite",
    run: (store) => store.delete(uploadId),
  });
}

export async function clearPendingUploads(): Promise<void> {
  if (!isIndexedDbSupported()) {
    return;
  }

  await runTransaction<unknown>({
    storeName: PENDING_UPLOADS_STORE,
    mode: "readwrite",
    run: (store) => store.clear(),
  });
}

export async function loadDraftProgress(jobId: string): Promise<DraftProgress | null> {
  if (!isIndexedDbSupported()) {
    return null;
  }

  const draft = await runTransaction<DraftProgress | undefined>({
    storeName: DRAFT_PROGRESS_STORE,
    mode: "readonly",
    run: (store) => store.get(jobId),
  });

  return draft ?? null;
}

export async function saveDraftProgress(draft: DraftProgress): Promise<void> {
  if (!isIndexedDbSupported()) {
    return;
  }

  await runTransaction<unknown>({
    storeName: DRAFT_PROGRESS_STORE,
    mode: "readwrite",
    run: (store) => store.put(draft),
  });
}

export async function clearDraftProgress(jobId: string): Promise<void> {
  if (!isIndexedDbSupported()) {
    return;
  }

  await runTransaction<unknown>({
    storeName: DRAFT_PROGRESS_STORE,
    mode: "readwrite",
    run: (store) => store.delete(jobId),
  });
}
