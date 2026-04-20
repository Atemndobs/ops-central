import test from "node:test";
import assert from "node:assert/strict";

import { getIncidentPhotoPreviews } from "./incident-photo-previews.ts";
import type { PendingUpload } from "./offline/types.ts";

function makeUpload(overrides: Partial<PendingUpload> = {}): PendingUpload {
  return {
    id: overrides.id ?? "upload-1",
    jobId: overrides.jobId ?? "job-1",
    roomName: overrides.roomName ?? "Kitchen",
    photoType: overrides.photoType ?? "incident",
    fileName: overrides.fileName ?? "incident.jpg",
    mimeType: overrides.mimeType ?? "image/jpeg",
    fileDataUrl: overrides.fileDataUrl ?? "data:image/jpeg;base64,AA==",
    createdAt: overrides.createdAt ?? 100,
    attempts: overrides.attempts ?? 0,
    status: overrides.status ?? "pending",
    lastError: overrides.lastError,
  };
}

test("getIncidentPhotoPreviews uses pending uploads first and falls back to saved photos", () => {
  const previews = getIncidentPhotoPreviews({
    photoRefs: ["upload-1", "photo-2"],
    pendingUploads: [makeUpload({ id: "upload-1", fileDataUrl: "data:local-preview" })],
    serverIncidentPhotos: [{ photoId: "photo-2", url: "https://example.com/photo-2.jpg" }],
  });

  assert.deepEqual(previews, [
    { photoRef: "upload-1", url: "data:local-preview" },
    { photoRef: "photo-2", url: "https://example.com/photo-2.jpg" },
  ]);
});

test("getIncidentPhotoPreviews omits photo refs with no available preview", () => {
  const previews = getIncidentPhotoPreviews({
    photoRefs: ["missing"],
    pendingUploads: [],
    serverIncidentPhotos: [],
  });

  assert.deepEqual(previews, []);
});
