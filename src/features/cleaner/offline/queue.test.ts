import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSyncState,
  enqueueUpload,
  getNextPendingUploads,
  markUploadFailed,
  markUploadSyncing,
  removeUpload,
  resetFailedUploads,
} from "./queue";
import type { PendingUpload } from "./types";

function makeUpload(overrides: Partial<PendingUpload> = {}): PendingUpload {
  return {
    id: overrides.id ?? "upload-1",
    jobId: overrides.jobId ?? "job-1",
    roomName: overrides.roomName ?? "Kitchen",
    photoType: overrides.photoType ?? "before",
    fileName: overrides.fileName ?? "kitchen.jpg",
    mimeType: overrides.mimeType ?? "image/jpeg",
    fileDataUrl: overrides.fileDataUrl ?? "data:image/jpeg;base64,AA==",
    createdAt: overrides.createdAt ?? 100,
    attempts: overrides.attempts ?? 0,
    status: overrides.status ?? "pending",
    lastError: overrides.lastError,
  };
}

test("enqueueUpload appends and keeps queue sorted", () => {
  const queue = [makeUpload({ id: "b", createdAt: 200 })];
  const next = enqueueUpload(queue, makeUpload({ id: "a", createdAt: 100 }));

  assert.deepEqual(next.map((item) => item.id), ["a", "b"]);
});

test("enqueueUpload replaces existing item with same id", () => {
  const queue = [makeUpload({ id: "x", roomName: "Kitchen" })];
  const next = enqueueUpload(queue, makeUpload({ id: "x", roomName: "Bathroom" }));

  assert.equal(next.length, 1);
  assert.equal(next[0].roomName, "Bathroom");
});

test("markUploadSyncing increments attempts and marks syncing", () => {
  const queue = [makeUpload({ id: "x", attempts: 1 })];
  const next = markUploadSyncing(queue, "x");

  assert.equal(next[0].status, "syncing");
  assert.equal(next[0].attempts, 2);
});

test("markUploadFailed marks failed and preserves queue size", () => {
  const queue = [makeUpload({ id: "x", status: "syncing" })];
  const next = markUploadFailed(queue, "x", "network error");

  assert.equal(next.length, 1);
  assert.equal(next[0].status, "failed");
  assert.equal(next[0].lastError, "network error");
});

test("resetFailedUploads requeues failed entries", () => {
  const queue = [makeUpload({ id: "x", status: "failed", lastError: "oops" })];
  const next = resetFailedUploads(queue);

  assert.equal(next[0].status, "pending");
  assert.equal(next[0].lastError, undefined);
});

test("getNextPendingUploads returns earliest pending items", () => {
  const queue = [
    makeUpload({ id: "a", createdAt: 300, status: "pending" }),
    makeUpload({ id: "b", createdAt: 100, status: "failed" }),
    makeUpload({ id: "c", createdAt: 200, status: "pending" }),
  ];

  const next = getNextPendingUploads(queue, 1);
  assert.deepEqual(next.map((item) => item.id), ["c"]);
});

test("removeUpload deletes target upload id", () => {
  const queue = [makeUpload({ id: "a" }), makeUpload({ id: "b" })];
  const next = removeUpload(queue, "a");

  assert.deepEqual(next.map((item) => item.id), ["b"]);
});

test("buildSyncState computes canSubmit correctly", () => {
  const queue = [makeUpload({ id: "a", status: "pending" })];
  const failedQueue = [makeUpload({ id: "b", status: "failed" })];
  const offline = buildSyncState({ queue, isOnline: false, isSyncing: false });
  const onlineWithQueue = buildSyncState({ queue, isOnline: true, isSyncing: false });
  const onlineWithFailed = buildSyncState({ queue: failedQueue, isOnline: true, isSyncing: false });
  const clearQueue = buildSyncState({ queue: [], isOnline: true, isSyncing: false });

  assert.equal(offline.canSubmit, false);
  assert.equal(onlineWithQueue.canSubmit, false);
  assert.equal(onlineWithFailed.canSubmit, false);
  assert.equal(clearQueue.canSubmit, true);
});
