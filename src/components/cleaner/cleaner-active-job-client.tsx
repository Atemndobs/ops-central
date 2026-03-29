"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { SyncBanner } from "@/components/cleaner/sync-banner";
import { dataUrlToBlob, fileToDataUrl } from "@/features/cleaner/offline/blob";
import {
  clearDraftProgress,
  deletePendingUpload,
  listPendingUploads,
  loadDraftProgress,
  saveDraftProgress,
  upsertPendingUpload,
} from "@/features/cleaner/offline/indexeddb";
import {
  buildSyncState,
  enqueueUpload,
  getNextPendingUploads,
  markUploadFailed,
  markUploadSyncing,
  removeUpload,
  resetFailedUploads,
} from "@/features/cleaner/offline/queue";
import type { DraftIncident, DraftProgress, PendingUpload } from "@/features/cleaner/offline/types";
import { getErrorMessage } from "@/lib/errors";

type ActivePhase = DraftProgress["phase"];

const DEFAULT_ROOMS = ["Living Room", "Kitchen", "Bedroom", "Bathroom"];

function readRoomName(value: unknown): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }
  const roomName = value.trim();
  return roomName.length > 0 ? roomName : null;
}

function buildRoomList(detail: JobDetailLike | null | undefined): string[] {
  const set = new Set<string>(DEFAULT_ROOMS);
  if (!detail) {
    return [...set];
  }

  const byRoom = detail.evidence?.current?.byRoom ?? [];
  byRoom.forEach((row) => {
    const roomName = readRoomName((row as { roomName?: unknown }).roomName);
    if (roomName) {
      set.add(roomName);
    }
  });

  const byType = detail.evidence?.current?.byType;
  (byType?.before ?? []).forEach((photo) => {
    const roomName = readRoomName((photo as { roomName?: unknown }).roomName);
    if (roomName) {
      set.add(roomName);
    }
  });
  (byType?.after ?? []).forEach((photo) => {
    const roomName = readRoomName((photo as { roomName?: unknown }).roomName);
    if (roomName) {
      set.add(roomName);
    }
  });

  return [...set];
}

function getCountByRoom(args: {
  roomName: string;
  type: "before" | "after" | "incident";
  detail: JobDetailLike | null | undefined;
  pendingUploads: PendingUpload[];
}) {
  const serverCount = (args.detail?.evidence?.current?.byType?.[args.type] ?? []).filter((photo) => {
    return readRoomName((photo as { roomName?: unknown }).roomName) === args.roomName;
  }).length;

  const localCount = args.pendingUploads.filter(
    (upload) => upload.roomName === args.roomName && upload.photoType === args.type,
  ).length;

  return serverCount + localCount;
}

type JobDetailLike = {
  job: {
    _id: Id<"cleaningJobs">;
    status: string;
    propertyId: Id<"properties">;
    notesForCleaner?: string;
  };
  property?: { name?: string | null; address?: string | null } | null;
  evidence: {
    current: {
      byType: {
        before: Array<{ roomName?: string | null }>;
        after: Array<{ roomName?: string | null }>;
        incident: Array<{ roomName?: string | null }>;
      };
      byRoom: Array<{ roomName?: string | null }>;
    };
  };
};

export function CleanerActiveJobClient({ id }: { id: string }) {
  const router = useRouter();
  const jobId = id as Id<"cleaningJobs">;
  const { isAuthenticated, isLoading } = useConvexAuth();

  const detail = useQuery(
    api.cleaningJobs.queries.getMyJobDetail,
    isAuthenticated ? { jobId } : "skip",
  ) as
    | JobDetailLike
    | null
    | undefined;

  const startJob = useMutation(api.cleaningJobs.mutations.start);
  const startJobRef = useRef(startJob);
  startJobRef.current = startJob;
  const pingActiveSession = useMutation(api.cleaningJobs.mutations.pingActiveSession);
  const pingActiveSessionRef = useRef(pingActiveSession);
  pingActiveSessionRef.current = pingActiveSession;
  const submitForApproval = useMutation(api.cleaningJobs.mutations.submitForApproval);
  const createIncident = useMutation(api.incidents.mutations.createIncident);
  const generateUploadUrl = useMutation(api.files.mutations.generateUploadUrl);
  const generateUploadUrlRef = useRef(generateUploadUrl);
  generateUploadUrlRef.current = generateUploadUrl;
  const uploadJobPhoto = useMutation(api.files.mutations.uploadJobPhoto);
  const uploadJobPhotoRef = useRef(uploadJobPhoto);
  uploadJobPhotoRef.current = uploadJobPhoto;

  const [phase, setPhase] = useState<ActivePhase>("before_photos");
  const [checklistDoneRooms, setChecklistDoneRooms] = useState<string[]>([]);
  const [skippedRooms, setSkippedRooms] = useState<Array<{ roomName: string; reason: string }>>([]);
  const [qaMode, setQaMode] = useState<"standard" | "quick">("standard");
  const [quickMinimumBefore, setQuickMinimumBefore] = useState(2);
  const [quickMinimumAfter, setQuickMinimumAfter] = useState(2);
  const [completionNotes, setCompletionNotes] = useState("");
  const [guestReady, setGuestReady] = useState(false);
  const [incidents, setIncidents] = useState<DraftIncident[]>([]);

  const [newIncidentTitle, setNewIncidentTitle] = useState("");
  const [newIncidentDescription, setNewIncidentDescription] = useState("");
  const [newIncidentRoomName, setNewIncidentRoomName] = useState("");
  const [newIncidentSeverity, setNewIncidentSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");

  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const isSyncingRef = useRef(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [canForceSubmit, setCanForceSubmit] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const roomList = useMemo(() => buildRoomList(detail), [detail]);

  const syncState = useMemo(
    () =>
      buildSyncState({
        queue: pendingUploads,
        isOnline,
        isSyncing,
        lastError: syncError ?? undefined,
      }),
    [isOnline, isSyncing, pendingUploads, syncError],
  );

  const hydrateLocalState = useCallback(async () => {
    const [queue, draft] = await Promise.all([listPendingUploads(), loadDraftProgress(jobId)]);
    setPendingUploads(queue.filter((upload) => upload.jobId === jobId));

    if (draft) {
      setPhase(draft.phase);
      setChecklistDoneRooms(draft.checklistDoneRooms);
      setSkippedRooms(draft.skippedRooms);
      setQaMode(draft.qaMode);
      setQuickMinimumBefore(draft.quickMinimumBefore);
      setQuickMinimumAfter(draft.quickMinimumAfter);
      setCompletionNotes(draft.completionNotes);
      setGuestReady(draft.guestReady);
      setIncidents(draft.incidents);
    }
  }, [jobId]);

  const drainQueue = useCallback(async () => {
    if (!isOnline || isSyncingRef.current) {
      return;
    }

    isSyncingRef.current = true;
    setIsSyncing(true);
    setSyncError(null);

    let queue = (await listPendingUploads()).filter((item) => item.jobId === jobId);
    if (isOnline && queue.some((item) => item.status === "failed")) {
      const resetQueue = resetFailedUploads(queue);
      const updatedEntries = resetQueue.filter((item) => {
        const previous = queue.find((candidate) => candidate.id === item.id);
        return previous?.status !== item.status || previous?.lastError !== item.lastError;
      });
      await Promise.all(updatedEntries.map((item) => upsertPendingUpload(item)));
      queue = resetQueue;
    }
    setPendingUploads(queue);

    for (const upload of getNextPendingUploads(queue, queue.length || 1)) {
      try {
        const syncingQueue = markUploadSyncing(queue, upload.id);
        const syncing = syncingQueue.find((item) => item.id === upload.id);
        if (!syncing) {
          queue = syncingQueue;
          continue;
        }

        await upsertPendingUpload(syncing);
        queue = syncingQueue;
        setPendingUploads(queue);

        const blob = dataUrlToBlob(syncing.fileDataUrl);
        const uploadUrl = await generateUploadUrlRef.current({});

        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": syncing.mimeType || "application/octet-stream" },
          body: blob,
        });

        if (!uploadResponse.ok) {
          throw new Error(`File upload failed (${uploadResponse.status}).`);
        }

        const payload = (await uploadResponse.json()) as { storageId?: Id<"_storage"> };
        if (!payload.storageId) {
          throw new Error("Upload response missing storageId.");
        }

        await uploadJobPhotoRef.current({
          storageId: payload.storageId,
          jobId,
          roomName: syncing.roomName,
          photoType: syncing.photoType,
          source: "app",
          notes: undefined,
        });

        await deletePendingUpload(syncing.id);
        queue = removeUpload(queue, syncing.id);
        setPendingUploads(queue);
      } catch (error) {
        const message = getErrorMessage(error, "Queue sync failed.");
        const failedQueue = markUploadFailed(queue, upload.id, message);
        const failed = failedQueue.find((item) => item.id === upload.id);
        if (failed) {
          await upsertPendingUpload(failed);
        }
        queue = failedQueue;
        setPendingUploads(queue);
        setSyncError(message);
      }
    }

    if (queue.every((item) => item.status !== "failed")) {
      setSyncError(null);
    }
    isSyncingRef.current = false;
    setIsSyncing(false);
  }, [isOnline, jobId]);

  useEffect(() => {
    void hydrateLocalState();
  }, [hydrateLocalState]);

  useEffect(() => {
    const updateOnline = () => setIsOnline(window.navigator.onLine);
    updateOnline();

    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  const drainQueueRef = useRef(drainQueue);
  drainQueueRef.current = drainQueue;

  useEffect(() => {
    if (isOnline) {
      void drainQueueRef.current();
    }
  }, [isOnline]);

  useEffect(() => {
    if (!detail) {
      return;
    }

    const status = detail.job.status;
    if (status === "awaiting_approval" || status === "completed" || status === "cancelled") {
      setPhase("review");
      return;
    }

    void startJobRef.current({
      jobId,
      startedAtDevice: Date.now(),
      offlineStartToken: `${jobId}-${Date.now()}`,
    }).catch((error) => {
      console.warn("[CleanerActiveJob] Unable to ensure start", error);
    });
  }, [detail, jobId]);

  useEffect(() => {
    if (!detail || detail.job.status !== "in_progress") {
      return;
    }

    const sendHeartbeat = () => {
      void pingActiveSessionRef.current({ jobId }).catch((error: unknown) => {
        console.warn("[CleanerActiveJob] Heartbeat failed", error);
      });
    };

    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [detail, jobId]);

  useEffect(() => {
    if (!detail) {
      return;
    }

    const draft: DraftProgress = {
      jobId,
      phase,
      checklistDoneRooms,
      skippedRooms,
      qaMode,
      quickMinimumBefore,
      quickMinimumAfter,
      requiredRooms: roomList,
      completionNotes,
      guestReady,
      incidents,
      updatedAt: Date.now(),
    };

    void saveDraftProgress(draft);
  }, [
    checklistDoneRooms,
    completionNotes,
    guestReady,
    incidents,
    jobId,
    phase,
    qaMode,
    quickMinimumAfter,
    quickMinimumBefore,
    roomList,
    skippedRooms,
    detail,
  ]);

  const addUploadFromFile = useCallback(
    async (args: { file: File; roomName: string; photoType: "before" | "after" | "incident" }) => {
      const fileDataUrl = await fileToDataUrl(args.file);
      const upload: PendingUpload = {
        id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        jobId,
        roomName: args.roomName,
        photoType: args.photoType,
        fileName: args.file.name || `${args.photoType}.jpg`,
        mimeType: args.file.type || "image/jpeg",
        fileDataUrl,
        createdAt: Date.now(),
        attempts: 0,
        status: "pending",
      };

      await upsertPendingUpload(upload);
      setPendingUploads((current) => enqueueUpload(current, upload));

      if (isOnline) {
        void drainQueue();
      }
    },
    [drainQueue, isOnline, jobId],
  );

  if (isLoading || !isAuthenticated || detail === undefined) {
    return <p className="text-sm text-[var(--muted-foreground)]">Loading active job...</p>;
  }

  if (!detail) {
    return <p className="text-sm text-[var(--muted-foreground)]">Job not found.</p>;
  }

  const currentBeforeTotal = roomList.reduce(
    (sum, roomName) =>
      sum +
      getCountByRoom({ roomName, type: "before", detail, pendingUploads }),
    0,
  );
  const currentAfterTotal = roomList.reduce(
    (sum, roomName) =>
      sum +
      getCountByRoom({ roomName, type: "after", detail, pendingUploads }),
    0,
  );

  const submitDisabled = !syncState.canSubmit || pendingSubmit;

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-base font-semibold">{detail.property?.name ?? "Unknown property"}</h2>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">{detail.property?.address ?? "No address"}</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">Status: {detail.job.status}</p>
      </section>

      <SyncBanner syncState={syncState} />

      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-3">
        <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Execution Phase</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {([
            ["before_photos", "Before"],
            ["cleaning", "Checklist"],
            ["after_photos", "After"],
            ["incidents", "Incidents"],
            ["review", "Review"],
          ] as Array<[ActivePhase, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`rounded-md border px-2 py-1 text-xs ${
                phase === value ? "border-[var(--primary)] text-[var(--primary)]" : "border-[var(--border)]"
              }`}
              onClick={() => setPhase(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {phase === "before_photos" || phase === "after_photos" ? (
        <section className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
          <h3 className="text-sm font-semibold">
            {phase === "before_photos" ? "Before Photos" : "After Photos"}
          </h3>
          {roomList.map((roomName) => {
            const count = getCountByRoom({
              roomName,
              type: phase === "before_photos" ? "before" : "after",
              detail,
              pendingUploads,
            });

            return (
              <div key={roomName} className="rounded-md border border-[var(--border)] p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{roomName}</p>
                  <span className="text-xs text-[var(--muted-foreground)]">{count} photo(s)</span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="mt-2 w-full text-xs"
                  onChange={async (event) => {
                    const files = event.target.files;
                    if (!files || files.length === 0) {
                      return;
                    }

                    for (const file of Array.from(files)) {
                      await addUploadFromFile({
                        file,
                        roomName,
                        photoType: phase === "before_photos" ? "before" : "after",
                      });
                    }

                    event.currentTarget.value = "";
                  }}
                />
              </div>
            );
          })}
        </section>
      ) : null}

      {phase === "cleaning" ? (
        <section className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
          <h3 className="text-sm font-semibold">Room Checklist</h3>
          {roomList.map((roomName) => {
            const checked = checklistDoneRooms.includes(roomName);
            const skipped = skippedRooms.find((room) => room.roomName === roomName);
            return (
              <div key={roomName} className="rounded-md border border-[var(--border)] p-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setChecklistDoneRooms((current) => {
                        if (enabled) {
                          return Array.from(new Set([...current, roomName]));
                        }
                        return current.filter((value) => value !== roomName);
                      });
                    }}
                  />
                  <span>{roomName}</span>
                </label>

                <div className="mt-2">
                  <input
                    value={skipped?.reason ?? ""}
                    onChange={(event) => {
                      const reason = event.target.value;
                      setSkippedRooms((current) => {
                        const next = current.filter((item) => item.roomName !== roomName);
                        if (reason.trim().length === 0) {
                          return next;
                        }
                        return [...next, { roomName, reason: reason.trim() }];
                      });
                    }}
                    placeholder="Optional skip reason"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                  />
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      {phase === "incidents" ? (
        <section className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
          <h3 className="text-sm font-semibold">Incidents</h3>
          <div className="grid gap-2">
            <input
              value={newIncidentTitle}
              onChange={(event) => setNewIncidentTitle(event.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
              placeholder="Incident title"
            />
            <input
              value={newIncidentRoomName}
              onChange={(event) => setNewIncidentRoomName(event.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
              placeholder="Room (optional)"
            />
            <select
              value={newIncidentSeverity}
              onChange={(event) =>
                setNewIncidentSeverity(event.target.value as "low" | "medium" | "high" | "critical")
              }
              className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </select>
            <textarea
              value={newIncidentDescription}
              onChange={(event) => setNewIncidentDescription(event.target.value)}
              rows={3}
              className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
              placeholder="Description"
            />
            <button
              type="button"
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs"
              onClick={() => {
                const title = newIncidentTitle.trim();
                if (!title) {
                  return;
                }
                setIncidents((current) => [
                  ...current,
                  {
                    id: `inc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    title,
                    description: newIncidentDescription.trim() || undefined,
                    roomName: newIncidentRoomName.trim() || undefined,
                    severity: newIncidentSeverity,
                    localPhotoIds: [],
                  },
                ]);
                setNewIncidentTitle("");
                setNewIncidentDescription("");
                setNewIncidentRoomName("");
              }}
            >
              Add Incident
            </button>
          </div>

          {incidents.length > 0 ? (
            <ul className="space-y-2">
              {incidents.map((incident) => (
                <li key={incident.id} className="rounded-md border border-[var(--border)] p-2 text-xs">
                  <p className="font-semibold">{incident.title}</p>
                  <p className="text-[var(--muted-foreground)]">
                    {incident.roomName ?? "No room"} · {incident.severity ?? "medium"}
                  </p>
                  {incident.description ? <p className="mt-1">{incident.description}</p> : null}
                  <button
                    type="button"
                    className="mt-1 text-[var(--destructive)]"
                    onClick={() => {
                      setIncidents((current) => current.filter((item) => item.id !== incident.id));
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {phase === "review" ? (
        <section className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
          <h3 className="text-sm font-semibold">Review and Submit</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            Before photos: {currentBeforeTotal} · After photos: {currentAfterTotal} · Incidents: {incidents.length}
          </p>

          <div>
            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">QA Mode</label>
            <select
              value={qaMode}
              onChange={(event) => setQaMode(event.target.value as "standard" | "quick")}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
            >
              <option value="standard">standard</option>
              <option value="quick">quick</option>
            </select>
          </div>

          {qaMode === "quick" ? (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min={1}
                value={quickMinimumBefore}
                onChange={(event) => setQuickMinimumBefore(Math.max(1, Number(event.target.value) || 1))}
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
                placeholder="Min before"
              />
              <input
                type="number"
                min={1}
                value={quickMinimumAfter}
                onChange={(event) => setQuickMinimumAfter(Math.max(1, Number(event.target.value) || 1))}
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
                placeholder="Min after"
              />
            </div>
          ) : null}

          <textarea
            value={completionNotes}
            onChange={(event) => setCompletionNotes(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
            placeholder="Completion notes"
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={guestReady}
              onChange={(event) => setGuestReady(event.target.checked)}
            />
            <span>Guest ready</span>
          </label>

          <button
            type="button"
            disabled={submitDisabled}
            className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            onClick={async () => {
              setPendingSubmit(true);
              setSubmitError(null);
              setCanForceSubmit(false);
              setSubmitSuccess(null);

              try {
                if (!syncState.canSubmit) {
                  throw new Error(
                    "You must be online and all queued uploads must finish before submitting.",
                  );
                }

                for (const incident of incidents) {
                  await createIncident({
                    propertyId: detail.job.propertyId,
                    cleaningJobId: detail.job._id,
                    incidentType: "other",
                    severity: incident.severity,
                    title: incident.title,
                    description: incident.description,
                    roomName: incident.roomName,
                  });
                }

                const result = (await submitForApproval({
                  jobId,
                  notes: completionNotes.trim() || undefined,
                  guestReady,
                  qaMode,
                  quickMinimumBefore: qaMode === "quick" ? quickMinimumBefore : undefined,
                  quickMinimumAfter: qaMode === "quick" ? quickMinimumAfter : undefined,
                  requiredRooms: roomList,
                  skippedRooms: skippedRooms.length > 0 ? skippedRooms : undefined,
                  submittedAtDevice: Date.now(),
                })) as { ok?: boolean; unresolvedCleanerIds?: string[] };

                if (result && result.ok === false) {
                  throw new Error(
                    `Cannot submit yet. ${result.unresolvedCleanerIds?.length ?? 0} cleaner session(s) are unresolved.`,
                  );
                }

                await clearDraftProgress(jobId);
                setSubmitSuccess("Work submitted for approval.");
                router.push(`/cleaner/jobs/${jobId}`);
              } catch (error) {
                const msg = getErrorMessage(error, "Unable to submit for approval.");
                const isValidation = msg.includes("Evidence validation failed");
                setSubmitError(isValidation ? msg.replace("Evidence validation failed: ", "") : msg);
                setCanForceSubmit(isValidation);
              } finally {
                setPendingSubmit(false);
              }
            }}
          >
            {pendingSubmit ? "Submitting..." : "Submit For Approval"}
          </button>

          {submitError ? (
            <div className="space-y-2">
              <p className="text-xs text-[var(--destructive)]">{submitError}</p>
              {canForceSubmit ? (
                <button
                  type="button"
                  disabled={pendingSubmit}
                  className="rounded-lg border border-[var(--destructive)] px-3 py-1.5 text-xs font-semibold text-[var(--destructive)] hover:bg-[var(--destructive)]/10"
                  onClick={async () => {
                    try {
                      setPendingSubmit(true);
                      setSubmitError(null);
                      setCanForceSubmit(false);

                      const result = (await submitForApproval({
                        jobId,
                        notes: completionNotes.trim() || undefined,
                        guestReady,
                        qaMode,
                        quickMinimumBefore: qaMode === "quick" ? quickMinimumBefore : undefined,
                        quickMinimumAfter: qaMode === "quick" ? quickMinimumAfter : undefined,
                        requiredRooms: roomList,
                        skippedRooms: skippedRooms.length > 0 ? skippedRooms : undefined,
                        submittedAtDevice: Date.now(),
                        force: true,
                      })) as { ok?: boolean };

                      if (result && result.ok === false) {
                        throw new Error("Unable to force-submit.");
                      }

                      await clearDraftProgress(jobId);
                      setSubmitSuccess("Work submitted for approval (with override).");
                      router.push(`/cleaner/jobs/${jobId}`);
                    } catch (error) {
                      setSubmitError(getErrorMessage(error, "Unable to force-submit."));
                    } finally {
                      setPendingSubmit(false);
                    }
                  }}
                >
                  {pendingSubmit ? "Submitting..." : "Submit Anyway"}
                </button>
              ) : null}
            </div>
          ) : null}
          {submitSuccess ? <p className="text-xs text-emerald-300">{submitSuccess}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
