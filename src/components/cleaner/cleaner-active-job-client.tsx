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

const STEPS: Array<{ phase: ActivePhase; label: string; shortLabel: string }> = [
  { phase: "before_photos", label: "Before Photos", shortLabel: "Before" },
  { phase: "cleaning",      label: "Cleaning Checklist", shortLabel: "Checklist" },
  { phase: "after_photos",  label: "After Photos", shortLabel: "After" },
  { phase: "incidents",     label: "Incidents", shortLabel: "Issues" },
  { phase: "review",        label: "Review & Submit", shortLabel: "Submit" },
];

const DEFAULT_ROOMS = ["Living Room", "Kitchen", "Bedroom", "Bathroom"];

function readRoomName(value: unknown): string | null {
  if (!value || typeof value !== "string") return null;
  const roomName = value.trim();
  return roomName.length > 0 ? roomName : null;
}

function buildRoomList(detail: JobDetailLike | null | undefined): string[] {
  const set = new Set<string>(DEFAULT_ROOMS);
  if (!detail) return [...set];

  const byRoom = detail.evidence?.current?.byRoom ?? [];
  byRoom.forEach((row) => {
    const roomName = readRoomName((row as { roomName?: unknown }).roomName);
    if (roomName) set.add(roomName);
  });

  const byType = detail.evidence?.current?.byType;
  (byType?.before ?? []).forEach((photo) => {
    const roomName = readRoomName((photo as { roomName?: unknown }).roomName);
    if (roomName) set.add(roomName);
  });
  (byType?.after ?? []).forEach((photo) => {
    const roomName = readRoomName((photo as { roomName?: unknown }).roomName);
    if (roomName) set.add(roomName);
  });

  return [...set];
}

function getCountByRoom(args: {
  roomName: string;
  type: "before" | "after" | "incident";
  detail: JobDetailLike | null | undefined;
  pendingUploads: PendingUpload[];
}) {
  const serverCount = (args.detail?.evidence?.current?.byType?.[args.type] ?? []).filter(
    (photo) => readRoomName((photo as { roomName?: unknown }).roomName) === args.roomName,
  ).length;
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

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepIndicator({
  currentIndex,
  visitedIndices,
  onGoTo,
}: {
  currentIndex: number;
  visitedIndices: Set<number>;
  onGoTo: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, index) => {
        const isActive    = index === currentIndex;
        const isCompleted = visitedIndices.has(index) && index < currentIndex;
        const isVisited   = visitedIndices.has(index);
        const isClickable = isVisited || index <= currentIndex;

        return (
          <div key={step.phase} className="flex flex-1 items-center">
            {/* Step dot + label */}
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onGoTo(index)}
              className="flex flex-col items-center gap-1 disabled:cursor-default"
            >
              <span
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors",
                  isActive
                    ? "border-blue-500 bg-blue-500 text-white"
                    : isCompleted
                    ? "border-blue-500 bg-blue-500/20 text-blue-400"
                    : isVisited
                    ? "border-zinc-500 bg-zinc-700 text-zinc-300"
                    : "border-zinc-700 bg-zinc-800 text-zinc-600",
                ].join(" ")}
              >
                {isCompleted ? "✓" : index + 1}
              </span>
              <span
                className={[
                  "hidden text-[10px] font-medium sm:block",
                  isActive ? "text-blue-400" : isCompleted ? "text-blue-500" : "text-zinc-500",
                ].join(" ")}
              >
                {step.shortLabel}
              </span>
            </button>

            {/* Connector line between steps */}
            {index < STEPS.length - 1 && (
              <div
                className={[
                  "h-0.5 flex-1 transition-colors",
                  index < currentIndex ? "bg-blue-500/50" : "bg-zinc-700",
                ].join(" ")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CleanerActiveJobClient({ id }: { id: string }) {
  const router = useRouter();
  const jobId = id as Id<"cleaningJobs">;
  const { isAuthenticated, isLoading } = useConvexAuth();

  const detail = useQuery(
    api.cleaningJobs.queries.getMyJobDetail,
    isAuthenticated ? { jobId } : "skip",
  ) as JobDetailLike | null | undefined;

  const startJob            = useMutation(api.cleaningJobs.mutations.start);
  const startJobRef         = useRef(startJob);
  startJobRef.current       = startJob;
  const pingActiveSession   = useMutation(api.cleaningJobs.mutations.pingActiveSession);
  const pingActiveSessionRef = useRef(pingActiveSession);
  pingActiveSessionRef.current = pingActiveSession;
  const submitForApproval   = useMutation(api.cleaningJobs.mutations.submitForApproval);
  const createIncident      = useMutation(api.incidents.mutations.createIncident);
  const generateUploadUrl   = useMutation(api.files.mutations.generateUploadUrl);
  const generateUploadUrlRef = useRef(generateUploadUrl);
  generateUploadUrlRef.current = generateUploadUrl;
  const uploadJobPhoto      = useMutation(api.files.mutations.uploadJobPhoto);
  const uploadJobPhotoRef   = useRef(uploadJobPhoto);
  uploadJobPhotoRef.current = uploadJobPhoto;

  // Phase / stepper state
  const [phase, setPhase] = useState<ActivePhase>("before_photos");
  const [visitedIndices, setVisitedIndices] = useState<Set<number>>(new Set([0]));

  const currentStepIndex = STEPS.findIndex((s) => s.phase === phase);

  const goToStep = (index: number) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, index));
    setPhase(STEPS[clamped].phase);
    setVisitedIndices((prev) => new Set([...prev, clamped]));
  };

  const goNext = () => goToStep(currentStepIndex + 1);
  const goBack = () => goToStep(currentStepIndex - 1);

  // Job execution state
  const [checklistDoneRooms, setChecklistDoneRooms] = useState<string[]>([]);
  const [skippedRooms, setSkippedRooms]             = useState<Array<{ roomName: string; reason: string }>>([]);
  const [qaMode, setQaMode]                         = useState<"standard" | "quick">("standard");
  const [quickMinimumBefore, setQuickMinimumBefore] = useState(2);
  const [quickMinimumAfter, setQuickMinimumAfter]   = useState(2);
  const [completionNotes, setCompletionNotes]       = useState("");
  const [guestReady, setGuestReady]                 = useState(false);
  const [incidents, setIncidents]                   = useState<DraftIncident[]>([]);

  const [newIncidentTitle, setNewIncidentTitle]             = useState("");
  const [newIncidentDescription, setNewIncidentDescription] = useState("");
  const [newIncidentRoomName, setNewIncidentRoomName]       = useState("");
  const [newIncidentSeverity, setNewIncidentSeverity]       = useState<"low" | "medium" | "high" | "critical">("medium");

  // Offline / sync state
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [isOnline, setIsOnline]             = useState(true);
  const [isSyncing, setIsSyncing]           = useState(false);
  const isSyncingRef                        = useRef(false);
  const [syncError, setSyncError]           = useState<string | null>(null);

  // Submit state
  const [pendingSubmit, setPendingSubmit]   = useState(false);
  const [submitError, setSubmitError]       = useState<string | null>(null);
  const [canForceSubmit, setCanForceSubmit] = useState(false);
  const [submitSuccess, setSubmitSuccess]   = useState<string | null>(null);

  const roomList = useMemo(() => buildRoomList(detail), [detail]);

  const syncState = useMemo(
    () => buildSyncState({ queue: pendingUploads, isOnline, isSyncing, lastError: syncError ?? undefined }),
    [isOnline, isSyncing, pendingUploads, syncError],
  );

  // ── Hydrate local draft from IndexedDB on mount ──────────────────────────
  const hydrateLocalState = useCallback(async () => {
    const [queue, draft] = await Promise.all([listPendingUploads(), loadDraftProgress(jobId)]);
    setPendingUploads(queue.filter((u) => u.jobId === jobId));

    if (draft) {
      const draftStepIndex = STEPS.findIndex((s) => s.phase === draft.phase);
      setPhase(draft.phase);
      setVisitedIndices(new Set(STEPS.map((_, i) => i).filter((i) => i <= draftStepIndex)));
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

  // ── Upload queue drainer ─────────────────────────────────────────────────
  const drainQueue = useCallback(async () => {
    if (!isOnline || isSyncingRef.current) return;

    isSyncingRef.current = true;
    setIsSyncing(true);
    setSyncError(null);

    let queue = (await listPendingUploads()).filter((item) => item.jobId === jobId);

    if (isOnline && queue.some((item) => item.status === "failed")) {
      const resetQueue = resetFailedUploads(queue);
      const updatedEntries = resetQueue.filter((item) => {
        const previous = queue.find((c) => c.id === item.id);
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
        if (!syncing) { queue = syncingQueue; continue; }

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

        if (!uploadResponse.ok) throw new Error(`File upload failed (${uploadResponse.status}).`);

        const payload = (await uploadResponse.json()) as { storageId?: Id<"_storage"> };
        if (!payload.storageId) throw new Error("Upload response missing storageId.");

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
        if (failed) await upsertPendingUpload(failed);
        queue = failedQueue;
        setPendingUploads(queue);
        setSyncError(message);
      }
    }

    if (queue.every((item) => item.status !== "failed")) setSyncError(null);
    isSyncingRef.current = false;
    setIsSyncing(false);
  }, [isOnline, jobId]);

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => { void hydrateLocalState(); }, [hydrateLocalState]);

  useEffect(() => {
    const update = () => setIsOnline(window.navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  const drainQueueRef = useRef(drainQueue);
  drainQueueRef.current = drainQueue;
  useEffect(() => { if (isOnline) void drainQueueRef.current(); }, [isOnline]);

  // Auto-start job and redirect finished jobs to review step
  useEffect(() => {
    if (!detail) return;
    const { status } = detail.job;
    if (status === "awaiting_approval" || status === "completed" || status === "cancelled") {
      goToStep(STEPS.length - 1);
      return;
    }
    void startJobRef.current({
      jobId,
      startedAtDevice: Date.now(),
      offlineStartToken: `${jobId}-${Date.now()}`,
    }).catch((error) => { console.warn("[CleanerActiveJob] Unable to ensure start", error); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, jobId]);

  // Heartbeat
  useEffect(() => {
    if (!detail || detail.job.status !== "in_progress") return;
    const send = () => { void pingActiveSessionRef.current({ jobId }).catch((e: unknown) => { console.warn("[CleanerActiveJob] Heartbeat failed", e); }); };
    send();
    const timer = window.setInterval(send, 30_000);
    return () => { window.clearInterval(timer); };
  }, [detail, jobId]);

  // Persist draft to IndexedDB whenever execution state changes
  useEffect(() => {
    if (!detail) return;
    void saveDraftProgress({
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
    });
  }, [checklistDoneRooms, completionNotes, guestReady, incidents, jobId, phase, qaMode, quickMinimumAfter, quickMinimumBefore, roomList, skippedRooms, detail]);

  // ── Photo upload helper ───────────────────────────────────────────────────
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
      if (isOnline) void drainQueue();
    },
    [drainQueue, isOnline, jobId],
  );

  // ── Loading / error guards ────────────────────────────────────────────────
  if (isLoading || !isAuthenticated || detail === undefined) {
    return <p className="p-4 text-sm text-zinc-400">Loading active job...</p>;
  }
  if (!detail) {
    return <p className="p-4 text-sm text-zinc-400">Job not found.</p>;
  }

  // ── Totals for review summary ─────────────────────────────────────────────
  const currentBeforeTotal = roomList.reduce(
    (sum, roomName) => sum + getCountByRoom({ roomName, type: "before", detail, pendingUploads }), 0,
  );
  const currentAfterTotal = roomList.reduce(
    (sum, roomName) => sum + getCountByRoom({ roomName, type: "after", detail, pendingUploads }), 0,
  );

  const submitDisabled = !syncState.canSubmit || pendingSubmit;
  const isLastStep = currentStepIndex === STEPS.length - 1;
  const isFirstStep = currentStepIndex === 0;

  // ── Submit handler ────────────────────────────────────────────────────────
  const handleSubmit = async (force = false) => {
    setPendingSubmit(true);
    setSubmitError(null);
    setCanForceSubmit(false);
    setSubmitSuccess(null);

    try {
      if (!syncState.canSubmit) {
        throw new Error("You must be online and all queued uploads must finish before submitting.");
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
        quickMinimumAfter:  qaMode === "quick" ? quickMinimumAfter  : undefined,
        requiredRooms: roomList,
        skippedRooms: skippedRooms.length > 0 ? skippedRooms : undefined,
        submittedAtDevice: Date.now(),
        ...(force ? { force: true } : {}),
      })) as { ok?: boolean; unresolvedCleanerIds?: string[] };

      if (result?.ok === false) {
        throw new Error(`Cannot submit yet. ${result.unresolvedCleanerIds?.length ?? 0} cleaner session(s) are unresolved.`);
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
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-0 flex-col gap-4">

      {/* Property header */}
      <section className="rounded-xl border border-zinc-700 bg-zinc-800/60 p-4">
        <h2 className="text-base font-semibold text-zinc-100">
          {detail.property?.name ?? "Unknown property"}
        </h2>
        <p className="mt-0.5 text-xs text-zinc-400">{detail.property?.address ?? "No address"}</p>
        {detail.job.notesForCleaner ? (
          <p className="mt-2 rounded-md bg-yellow-900/30 px-2 py-1.5 text-xs text-yellow-300">
            {detail.job.notesForCleaner}
          </p>
        ) : null}
      </section>

      <SyncBanner syncState={syncState} />

      {/* Step indicator */}
      <section className="rounded-xl border border-zinc-700 bg-zinc-800/60 px-4 py-3">
        <StepIndicator
          currentIndex={currentStepIndex}
          visitedIndices={visitedIndices}
          onGoTo={goToStep}
        />
        <p className="mt-3 text-center text-xs text-zinc-500">
          Step {currentStepIndex + 1} of {STEPS.length} — <span className="text-zinc-300">{STEPS[currentStepIndex].label}</span>
        </p>
      </section>

      {/* ── Step content ─────────────────────────────────────────────────── */}

      {/* STEP: Before / After photos */}
      {(phase === "before_photos" || phase === "after_photos") && (
        <section className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-800/60 p-4">
          <h3 className="text-sm font-semibold text-zinc-100">
            {phase === "before_photos" ? "Before Photos" : "After Photos"}
          </h3>
          <p className="text-xs text-zinc-500">
            Take at least one photo per room{phase === "before_photos" ? " before you start cleaning" : " after cleaning is complete"}.
          </p>
          <div className="space-y-2">
            {roomList.map((roomName) => {
              const photoType = phase === "before_photos" ? "before" : "after";
              const count = getCountByRoom({ roomName, type: photoType, detail, pendingUploads });
              return (
                <div key={roomName} className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-zinc-200">{roomName}</p>
                    <span className={["text-xs font-semibold tabular-nums", count > 0 ? "text-emerald-400" : "text-zinc-500"].join(" ")}>
                      {count > 0 ? `${count} photo${count !== 1 ? "s" : ""}` : "No photos yet"}
                    </span>
                  </div>
                  <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-zinc-600 py-2 text-xs text-zinc-400 hover:border-blue-500 hover:text-blue-400 active:opacity-70">
                    <span>＋ Add photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                      className="sr-only"
                      onChange={async (event) => {
                        const files = event.target.files;
                        if (!files || files.length === 0) return;
                        for (const file of Array.from(files)) {
                          await addUploadFromFile({ file, roomName, photoType });
                        }
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* STEP: Cleaning checklist */}
      {phase === "cleaning" && (
        <section className="space-y-2 rounded-xl border border-zinc-700 bg-zinc-800/60 p-4">
          <h3 className="text-sm font-semibold text-zinc-100">Room Checklist</h3>
          <p className="text-xs text-zinc-500">Mark each room as done, or add a skip reason if you couldn't clean it.</p>
          <div className="space-y-2 pt-1">
            {roomList.map((roomName) => {
              const checked = checklistDoneRooms.includes(roomName);
              const skipped = skippedRooms.find((room) => room.roomName === roomName);
              return (
                <div key={roomName} className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
                  <label className="flex cursor-pointer items-center gap-3 text-sm">
                    <span className={["flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-bold", checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-600 bg-zinc-800"].join(" ")}>
                      {checked ? "✓" : ""}
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      className="sr-only"
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setChecklistDoneRooms((current) =>
                          enabled ? Array.from(new Set([...current, roomName])) : current.filter((v) => v !== roomName),
                        );
                      }}
                    />
                    <span className={checked ? "text-zinc-300 line-through" : "text-zinc-200"}>{roomName}</span>
                  </label>
                  {!checked && (
                    <input
                      value={skipped?.reason ?? ""}
                      onChange={(event) => {
                        const reason = event.target.value;
                        setSkippedRooms((current) => {
                          const next = current.filter((item) => item.roomName !== roomName);
                          return reason.trim().length === 0 ? next : [...next, { roomName, reason: reason.trim() }];
                        });
                      }}
                      placeholder="Skip reason (optional)"
                      className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* STEP: Incidents */}
      {phase === "incidents" && (
        <section className="space-y-4 rounded-xl border border-zinc-700 bg-zinc-800/60 p-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Report Incidents</h3>
            <p className="mt-0.5 text-xs text-zinc-500">Log any damage, maintenance needs, or unexpected issues. You can skip this step if there's nothing to report.</p>
          </div>

          <div className="space-y-2 rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
            <input
              value={newIncidentTitle}
              onChange={(event) => setNewIncidentTitle(event.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              placeholder="Title (e.g. Broken lamp)"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={newIncidentRoomName}
                onChange={(event) => setNewIncidentRoomName(event.target.value)}
                className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                placeholder="Room (optional)"
              />
              <select
                value={newIncidentSeverity}
                onChange={(event) => setNewIncidentSeverity(event.target.value as "low" | "medium" | "high" | "critical")}
                className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <textarea
              value={newIncidentDescription}
              onChange={(event) => setNewIncidentDescription(event.target.value)}
              rows={2}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              placeholder="Description (optional)"
            />
            <button
              type="button"
              className="w-full rounded-md border border-zinc-600 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 active:opacity-70"
              onClick={() => {
                const title = newIncidentTitle.trim();
                if (!title) return;
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
              + Add Incident
            </button>
          </div>

          {incidents.length > 0 && (
            <ul className="space-y-2">
              {incidents.map((incident) => (
                <li key={incident.id} className="flex items-start justify-between gap-2 rounded-lg border border-zinc-700 bg-zinc-900/50 p-3 text-xs">
                  <div>
                    <p className="font-semibold text-zinc-200">{incident.title}</p>
                    <p className="mt-0.5 text-zinc-500">
                      {incident.roomName ?? "No room"} · <span className="capitalize">{incident.severity}</span>
                    </p>
                    {incident.description && <p className="mt-1 text-zinc-400">{incident.description}</p>}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-red-400 hover:text-red-300"
                    onClick={() => setIncidents((current) => current.filter((item) => item.id !== incident.id))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* STEP: Review & Submit */}
      {phase === "review" && (
        <section className="space-y-4 rounded-xl border border-zinc-700 bg-zinc-800/60 p-4">
          <h3 className="text-sm font-semibold text-zinc-100">Review & Submit</h3>

          {/* Summary counts */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Before Photos", value: currentBeforeTotal },
              { label: "After Photos",  value: currentAfterTotal },
              { label: "Incidents",     value: incidents.length },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border border-zinc-700 bg-zinc-900/50 py-2">
                <p className={["text-lg font-bold tabular-nums", value > 0 ? "text-zinc-100" : "text-zinc-600"].join(" ")}>{value}</p>
                <p className="text-[10px] text-zinc-500">{label}</p>
              </div>
            ))}
          </div>

          {/* QA mode */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">QA Mode</label>
            <select
              value={qaMode}
              onChange={(event) => setQaMode(event.target.value as "standard" | "quick")}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            >
              <option value="standard">Standard</option>
              <option value="quick">Quick (minimum photos)</option>
            </select>
          </div>

          {qaMode === "quick" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Min before photos</label>
                <input
                  type="number"
                  min={1}
                  value={quickMinimumBefore}
                  onChange={(event) => setQuickMinimumBefore(Math.max(1, Number(event.target.value) || 1))}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Min after photos</label>
                <input
                  type="number"
                  min={1}
                  value={quickMinimumAfter}
                  onChange={(event) => setQuickMinimumAfter(Math.max(1, Number(event.target.value) || 1))}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                />
              </div>
            </div>
          )}

          {/* Completion notes */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Completion notes (optional)</label>
            <textarea
              value={completionNotes}
              onChange={(event) => setCompletionNotes(event.target.value)}
              rows={3}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              placeholder="Any notes for the reviewer..."
            />
          </div>

          {/* Guest ready */}
          <label className="flex cursor-pointer items-center gap-3">
            <span className={["flex h-5 w-5 items-center justify-center rounded border text-xs font-bold", guestReady ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-600 bg-zinc-800"].join(" ")}>
              {guestReady ? "✓" : ""}
            </span>
            <input type="checkbox" checked={guestReady} className="sr-only" onChange={(e) => setGuestReady(e.target.checked)} />
            <span className="text-sm text-zinc-200">Unit is guest-ready</span>
          </label>

          {/* Submit */}
          <button
            type="button"
            disabled={submitDisabled}
            onClick={() => void handleSubmit(false)}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-lg hover:bg-blue-500 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pendingSubmit ? "Submitting..." : "Submit for Approval"}
          </button>

          {submitError && (
            <div className="space-y-2 rounded-lg border border-red-800 bg-red-900/20 p-3">
              <p className="text-xs text-red-400">{submitError}</p>
              {canForceSubmit && (
                <button
                  type="button"
                  disabled={pendingSubmit}
                  onClick={() => void handleSubmit(true)}
                  className="rounded-md border border-red-600 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-900/40 disabled:opacity-50"
                >
                  {pendingSubmit ? "Submitting..." : "Submit Anyway"}
                </button>
              )}
            </div>
          )}

          {submitSuccess && (
            <p className="text-center text-xs font-medium text-emerald-400">{submitSuccess}</p>
          )}
        </section>
      )}

      {/* ── Navigation footer ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 pb-6">
        <button
          type="button"
          onClick={goBack}
          disabled={isFirstStep}
          className="flex items-center gap-1.5 rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 active:opacity-70 disabled:invisible"
        >
          ← Back
        </button>

        {!isLastStep && (
          <button
            type="button"
            onClick={goNext}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-700 py-2.5 text-sm font-semibold text-zinc-100 hover:bg-zinc-600 active:opacity-70"
          >
            Next →
          </button>
        )}

        {isLastStep && (
          <div className="flex-1" /> // spacer so Back stays left-aligned on review step
        )}
      </div>

    </div>
  );
}
