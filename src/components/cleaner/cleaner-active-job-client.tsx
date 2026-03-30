"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { SyncBanner } from "@/components/cleaner/sync-banner";
import { dataUrlToBlob, fileToDataUrl, stampImageWithTimestamp } from "@/features/cleaner/offline/blob";
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

// Steps: cleaning step removed — skip is merged into before_photos
type ActivePhase = "before_photos" | "after_photos" | "incidents" | "review";

const STEPS: Array<{ phase: ActivePhase; label: string; shortLabel: string }> = [
  { phase: "before_photos", label: "Before Photos", shortLabel: "Before" },
  { phase: "after_photos",  label: "After Photos",  shortLabel: "After"  },
  { phase: "incidents",     label: "Incidents",     shortLabel: "Issues" },
  { phase: "review",        label: "Review & Submit", shortLabel: "Submit" },
];

const DEFAULT_ROOMS = ["Living Room", "Kitchen", "Bedroom", "Bathroom"];

function readRoomName(value: unknown): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildRoomList(detail: JobDetailLike | null | undefined): string[] {
  const set = new Set<string>(DEFAULT_ROOMS);
  if (!detail) return [...set];

  const byRoom = detail.evidence?.current?.byRoom ?? [];
  byRoom.forEach((row) => {
    const name = readRoomName((row as { roomName?: unknown }).roomName);
    if (name) set.add(name);
  });

  const byType = detail.evidence?.current?.byType;
  [...(byType?.before ?? []), ...(byType?.after ?? [])].forEach((photo) => {
    const name = readRoomName((photo as { roomName?: unknown }).roomName);
    if (name) set.add(name);
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
    (p) => readRoomName((p as { roomName?: unknown }).roomName) === args.roomName,
  ).length;
  const localCount = args.pendingUploads.filter(
    (u) => u.roomName === args.roomName && u.photoType === args.type,
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
        after:  Array<{ roomName?: string | null }>;
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
    <div className="flex items-center">
      {STEPS.map((step, index) => {
        const isActive    = index === currentIndex;
        const isCompleted = index < currentIndex;
        const isClickable = visitedIndices.has(index) || index <= currentIndex;

        return (
          <div key={step.phase} className="flex flex-1 items-center">
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
                    ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : isCompleted
                    ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                    : "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]",
                ].join(" ")}
              >
                {isCompleted ? "✓" : index + 1}
              </span>
              <span
                className={[
                  "hidden text-[10px] font-medium sm:block",
                  isActive    ? "text-[var(--primary)]"          : "",
                  isCompleted ? "text-[var(--primary)]"          : "",
                  !isActive && !isCompleted ? "text-[var(--muted-foreground)]" : "",
                ].join(" ")}
              >
                {step.shortLabel}
              </span>
            </button>
            {index < STEPS.length - 1 && (
              <div
                className={[
                  "h-0.5 flex-1 transition-colors",
                  index < currentIndex ? "bg-[var(--primary)]/40" : "bg-[var(--border)]",
                ].join(" ")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Room card with photos + skip ────────────────────────────────────────────

function RoomPhotoCard({
  roomName,
  photoType,
  photoCount,
  skippedReason,
  onAddFile,
  onSkip,
  onUnskip,
}: {
  roomName: string;
  photoType: "before" | "after";
  photoCount: number;
  skippedReason: string | undefined;
  onAddFile: (file: File) => Promise<void>;
  onSkip: (reason: string) => void;
  onUnskip: () => void;
}) {
  const [showSkipInput, setShowSkipInput] = useState(false);
  const [skipReason, setSkipReason] = useState("");

  const isSkipped = skippedReason !== undefined;
  const hasPhotos = photoCount > 0;

  if (isSkipped) {
    return (
      <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">{roomName}</p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Skipped{skippedReason ? `: ${skippedReason}` : ""}
            </p>
          </div>
          <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Skipped
          </span>
        </div>
        <button
          type="button"
          onClick={onUnskip}
          className="mt-2 text-xs text-[var(--primary)] underline-offset-2 hover:underline"
        >
          Undo skip
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-3">
      {/* Room header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[var(--foreground)]">{roomName}</p>
        {hasPhotos ? (
          <span className="text-xs font-semibold text-[var(--success,oklch(0.66_0.18_150))]">
            {photoCount} photo{photoCount !== 1 ? "s" : ""}
          </span>
        ) : (
          <span className="text-xs text-[var(--muted-foreground)]">No photos yet</span>
        )}
      </div>

      {/* Add photo */}
      <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border)] py-2.5 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] active:opacity-70">
        <span>+ Add photo</span>
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
              await onAddFile(file);
            }
            event.currentTarget.value = "";
          }}
        />
      </label>

      {/* Skip toggle */}
      {!showSkipInput && (
        <button
          type="button"
          onClick={() => setShowSkipInput(true)}
          className="mt-2 text-xs text-[var(--muted-foreground)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
        >
          Skip this room
        </button>
      )}

      {/* Skip reason form */}
      {showSkipInput && (
        <div className="mt-2 space-y-2 rounded-md border border-[var(--border)] bg-[var(--muted)]/40 p-2">
          <p className="text-xs font-medium text-[var(--foreground)]">Reason for skipping (optional)</p>
          <input
            autoFocus
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            placeholder="e.g. Room locked, guest still inside"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onSkip(skipReason.trim());
                setSkipReason("");
                setShowSkipInput(false);
              }}
              className="flex-1 rounded-md bg-[var(--primary)] py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
            >
              Confirm Skip
            </button>
            <button
              type="button"
              onClick={() => { setShowSkipInput(false); setSkipReason(""); }}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
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

  const startJob                = useMutation(api.cleaningJobs.mutations.start);
  const startJobRef             = useRef(startJob);
  startJobRef.current           = startJob;
  const pingActiveSession       = useMutation(api.cleaningJobs.mutations.pingActiveSession);
  const pingActiveSessionRef    = useRef(pingActiveSession);
  pingActiveSessionRef.current  = pingActiveSession;
  const submitForApproval       = useMutation(api.cleaningJobs.mutations.submitForApproval);
  const createIncident          = useMutation(api.incidents.mutations.createIncident);
  const generateUploadUrl       = useMutation(api.files.mutations.generateUploadUrl);
  const generateUploadUrlRef    = useRef(generateUploadUrl);
  generateUploadUrlRef.current  = generateUploadUrl;
  const uploadJobPhoto          = useMutation(api.files.mutations.uploadJobPhoto);
  const uploadJobPhotoRef       = useRef(uploadJobPhoto);
  uploadJobPhotoRef.current     = uploadJobPhoto;

  // Stepper
  const [phase, setPhase]                   = useState<ActivePhase>("before_photos");
  const [visitedIndices, setVisitedIndices] = useState<Set<number>>(new Set([0]));
  const currentStepIndex = STEPS.findIndex((s) => s.phase === phase);

  const goToStep = (index: number) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, index));
    setPhase(STEPS[clamped].phase);
    setVisitedIndices((prev) => new Set([...prev, clamped]));
  };
  const goNext = () => goToStep(currentStepIndex + 1);
  const goBack = () => goToStep(currentStepIndex - 1);

  // Job state — checklistDoneRooms kept for type compat but unused
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

  // Offline / sync
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [isOnline, setIsOnline]             = useState(true);
  const [isSyncing, setIsSyncing]           = useState(false);
  const isSyncingRef                        = useRef(false);
  const [syncError, setSyncError]           = useState<string | null>(null);

  // Incident prompt — shown between after_photos and incidents steps
  const [showIncidentPrompt, setShowIncidentPrompt] = useState(false);

  // Submit
  const [pendingSubmit, setPendingSubmit]   = useState(false);
  const [submitError, setSubmitError]       = useState<string | null>(null);
  const [canForceSubmit, setCanForceSubmit] = useState(false);
  const [submitSuccess, setSubmitSuccess]   = useState<string | null>(null);

  const roomList  = useMemo(() => buildRoomList(detail), [detail]);
  const syncState = useMemo(
    () => buildSyncState({ queue: pendingUploads, isOnline, isSyncing, lastError: syncError ?? undefined }),
    [isOnline, isSyncing, pendingUploads, syncError],
  );

  // ── Hydrate draft ─────────────────────────────────────────────────────────
  const hydrateLocalState = useCallback(async () => {
    const [rawQueue, draft] = await Promise.all([listPendingUploads(), loadDraftProgress(jobId)]);

    // Reset any uploads stuck in "syncing" from a previous interrupted session.
    // On a fresh page load nothing is actually in-flight, so "syncing" items are
    // orphaned and must be retried — otherwise canSubmit stays false forever.
    const jobQueue = rawQueue.filter((u) => u.jobId === jobId);
    const stuckSyncing = jobQueue.filter((u) => u.status === "syncing");
    if (stuckSyncing.length > 0) {
      await Promise.all(
        stuckSyncing.map((item) =>
          upsertPendingUpload({ ...item, status: "pending", lastError: undefined }),
        ),
      );
    }
    const cleanedQueue = jobQueue.map((u) =>
      u.status === "syncing" ? { ...u, status: "pending" as const, lastError: undefined } : u,
    );
    setPendingUploads(cleanedQueue);

    if (draft) {
      // Map old "cleaning" phase (from previous drafts) to before_photos
      const restoredPhase: ActivePhase =
        draft.phase === "cleaning" ? "before_photos"
        : (draft.phase as ActivePhase);
      const restoredIndex = STEPS.findIndex((s) => s.phase === restoredPhase);
      setPhase(restoredPhase);
      setVisitedIndices(new Set(STEPS.map((_, i) => i).filter((i) => i <= restoredIndex)));
      setSkippedRooms(draft.skippedRooms);
      setQaMode(draft.qaMode);
      setQuickMinimumBefore(draft.quickMinimumBefore);
      setQuickMinimumAfter(draft.quickMinimumAfter);
      setCompletionNotes(draft.completionNotes);
      setGuestReady(draft.guestReady);
      setIncidents(draft.incidents);
    }
  }, [jobId]);

  // ── Upload queue drainer ──────────────────────────────────────────────────
  const drainQueue = useCallback(async () => {
    if (!isOnline || isSyncingRef.current) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
    setSyncError(null);

    let queue = (await listPendingUploads()).filter((item) => item.jobId === jobId);

    if (isOnline && queue.some((item) => item.status === "failed")) {
      const reset = resetFailedUploads(queue);
      const changed = reset.filter((item) => {
        const prev = queue.find((c) => c.id === item.id);
        return prev?.status !== item.status || prev?.lastError !== item.lastError;
      });
      await Promise.all(changed.map((item) => upsertPendingUpload(item)));
      queue = reset;
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
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": syncing.mimeType || "application/octet-stream" },
          body: blob,
        });
        if (!res.ok) throw new Error(`File upload failed (${res.status}).`);

        const payload = (await res.json()) as { storageId?: Id<"_storage"> };
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

  useEffect(() => {
    if (!detail) return;
    const { status } = detail.job;
    if (status === "awaiting_approval" || status === "completed" || status === "cancelled") {
      goToStep(STEPS.length - 1);
      setPendingSubmit(false);
      return;
    }
    void startJobRef.current({
      jobId,
      startedAtDevice: Date.now(),
      offlineStartToken: `${jobId}-${Date.now()}`,
    }).catch((e) => { console.warn("[CleanerActiveJob] start failed", e); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, jobId]);

  useEffect(() => {
    if (!detail || detail.job.status !== "in_progress") return;
    const send = () => { void pingActiveSessionRef.current({ jobId }).catch((e: unknown) => { console.warn("[CleanerActiveJob] heartbeat failed", e); }); };
    send();
    const timer = window.setInterval(send, 30_000);
    return () => { window.clearInterval(timer); };
  }, [detail, jobId]);

  // Persist draft
  useEffect(() => {
    if (!detail) return;
    const draft: DraftProgress = {
      jobId,
      phase: phase === "before_photos" ? "before_photos"
           : phase === "after_photos"  ? "after_photos"
           : phase === "incidents"     ? "incidents"
           : "review",
      checklistDoneRooms: [], // unused — kept for type compat
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
  }, [completionNotes, guestReady, incidents, jobId, phase, qaMode, quickMinimumAfter, quickMinimumBefore, roomList, skippedRooms, detail]);

  // ── Photo upload helper ───────────────────────────────────────────────────
  const addUploadFromFile = useCallback(
    async (args: { file: File; roomName: string; photoType: "before" | "after" | "incident" }) => {
      const rawDataUrl = await fileToDataUrl(args.file);
      const capturedAt = new Date();
      const fileDataUrl = await stampImageWithTimestamp(rawDataUrl, capturedAt);
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

  // ── Guards ────────────────────────────────────────────────────────────────
  if (isLoading || !isAuthenticated || detail === undefined) {
    return <p className="p-4 text-sm text-[var(--muted-foreground)]">Loading active job...</p>;
  }
  if (!detail) {
    return <p className="p-4 text-sm text-[var(--muted-foreground)]">Job not found.</p>;
  }

  // ── Summary counts ────────────────────────────────────────────────────────
  const currentBeforeTotal = roomList.reduce(
    (sum, rn) => sum + getCountByRoom({ roomName: rn, type: "before", detail, pendingUploads }), 0,
  );
  const currentAfterTotal = roomList.reduce(
    (sum, rn) => sum + getCountByRoom({ roomName: rn, type: "after", detail, pendingUploads }), 0,
  );

  const isLastStep  = currentStepIndex === STEPS.length - 1;
  const isFirstStep = currentStepIndex === 0;
  const submitDisabled = !syncState.canSubmit || pendingSubmit;

  // ── Submit ────────────────────────────────────────────────────────────────
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
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">

      {/* Property header */}
      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-base font-semibold text-[var(--foreground)]">
          {detail.property?.name ?? "Unknown property"}
        </h2>
        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
          {detail.property?.address ?? "No address"}
        </p>
        {detail.job.notesForCleaner ? (
          <p className="mt-2 rounded-md bg-[var(--warning)]/15 px-2 py-1.5 text-xs text-[var(--warning-foreground,var(--foreground))]">
            {detail.job.notesForCleaner}
          </p>
        ) : null}
      </section>

      <SyncBanner syncState={syncState} />

      {/* Step indicator */}
      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <StepIndicator
          currentIndex={currentStepIndex}
          visitedIndices={visitedIndices}
          onGoTo={goToStep}
        />
        <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">
          Step {currentStepIndex + 1} of {STEPS.length} —{" "}
          <span className="font-medium text-[var(--foreground)]">{STEPS[currentStepIndex].label}</span>
        </p>
      </section>

      {/* ── STEP: Before / After photos ─────────────────────────────────── */}
      {(phase === "before_photos" || phase === "after_photos") && !showIncidentPrompt && (
        <section className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">
              {phase === "before_photos" ? "Before Photos" : "After Photos"}
            </h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {phase === "before_photos"
                ? "Take at least one photo per room before you start cleaning. Skip a room if you can't access it."
                : "Take at least one photo per room after cleaning is complete."}
            </p>
          </div>

          <div className="space-y-2">
            {roomList.map((roomName) => {
              const photoType = phase === "before_photos" ? "before" : "after";
              const count = getCountByRoom({ roomName, type: photoType, detail, pendingUploads });
              const skippedEntry = skippedRooms.find((r) => r.roomName === roomName);

              return (
                <RoomPhotoCard
                  key={roomName}
                  roomName={roomName}
                  photoType={photoType}
                  photoCount={count}
                  skippedReason={phase === "before_photos" ? skippedEntry?.reason : undefined}
                  onAddFile={(file) => addUploadFromFile({ file, roomName, photoType })}
                  onSkip={(reason) => {
                    setSkippedRooms((current) => {
                      const next = current.filter((r) => r.roomName !== roomName);
                      return [...next, { roomName, reason }];
                    });
                  }}
                  onUnskip={() => {
                    setSkippedRooms((current) => current.filter((r) => r.roomName !== roomName));
                  }}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* ── Incident prompt — shown when leaving after_photos ────────────── */}
      {phase === "after_photos" && showIncidentPrompt && (
        <section className="space-y-4 rounded-md border border-[var(--border)] bg-[var(--card)] p-6 text-center">
          <p className="text-3xl">⚠️</p>
          <h3 className="text-base font-semibold text-[var(--foreground)]">Any incidents to report?</h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            Log damage, maintenance needs, or unexpected issues found during cleaning.
          </p>
          <div className="flex flex-col gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setShowIncidentPrompt(false); goToStep(STEPS.findIndex((s) => s.phase === "incidents")); }}
              className="w-full rounded-md border border-[var(--destructive)]/50 bg-[var(--destructive)]/10 py-3 text-sm font-semibold text-[var(--destructive)] hover:bg-[var(--destructive)]/20 active:opacity-70"
            >
              Yes, report an incident
            </button>
            <button
              type="button"
              onClick={() => {
                setShowIncidentPrompt(false);
                // Mark the incidents step as visited so the stepper doesn't block it
                setVisitedIndices((prev) => new Set([...prev, STEPS.findIndex((s) => s.phase === "incidents")]));
                goToStep(STEPS.findIndex((s) => s.phase === "review"));
              }}
              className="w-full rounded-md bg-[var(--primary)] py-3 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 active:opacity-70"
            >
              No, skip to review →
            </button>
          </div>
        </section>
      )}

      {/* ── STEP: Incidents ──────────────────────────────────────────────── */}
      {phase === "incidents" && (
        <section className="space-y-4 rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Report Incidents</h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Log any damage, maintenance needs, or unexpected issues. Skip this step if there's nothing to report.
            </p>
          </div>

          <div className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
            <input
              value={newIncidentTitle}
              onChange={(e) => setNewIncidentTitle(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              placeholder="Title (e.g. Broken lamp)"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={newIncidentRoomName}
                onChange={(e) => setNewIncidentRoomName(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                placeholder="Room (optional)"
              />
              <select
                value={newIncidentSeverity}
                onChange={(e) => setNewIncidentSeverity(e.target.value as "low" | "medium" | "high" | "critical")}
                className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <textarea
              value={newIncidentDescription}
              onChange={(e) => setNewIncidentDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              placeholder="Description (optional)"
            />
            <button
              type="button"
              className="w-full rounded-md border border-[var(--border)] py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] active:opacity-70"
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
                <li key={incident.id} className="flex items-start justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] p-3 text-xs">
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">{incident.title}</p>
                    <p className="mt-0.5 text-[var(--muted-foreground)]">
                      {incident.roomName ?? "No room"} · <span className="capitalize">{incident.severity}</span>
                    </p>
                    {incident.description && (
                      <p className="mt-1 text-[var(--muted-foreground)]">{incident.description}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-[var(--destructive)] hover:opacity-80"
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

      {/* ── STEP: Review & Submit ────────────────────────────────────────── */}
      {phase === "review" && (
        <section className="space-y-4 rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Review & Submit</h3>

          {/* Summary counts */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Before",    value: currentBeforeTotal },
              { label: "After",     value: currentAfterTotal  },
              { label: "Incidents", value: incidents.length   },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-md border border-[var(--border)] bg-[var(--background)] py-2">
                <p className={[
                  "text-lg font-bold tabular-nums",
                  value > 0 ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]",
                ].join(" ")}>
                  {value}
                </p>
                <p className="text-[10px] text-[var(--muted-foreground)]">{label}</p>
              </div>
            ))}
          </div>

          {/* Already submitted — show status banner instead of submit form */}
          {(detail?.job.status === "awaiting_approval" || detail?.job.status === "completed") ? (
            <div className="rounded-md border border-[var(--warning,oklch(0.75_0.15_80))]/40 bg-[var(--warning,oklch(0.75_0.15_80))]/10 p-3 text-center">
              <p className="text-sm font-semibold text-[var(--foreground)]">
                {detail.job.status === "completed" ? "✓ Job Approved" : "⏳ Awaiting Approval"}
              </p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                {detail.job.status === "completed"
                  ? "This job has been reviewed and approved."
                  : "Your work has been submitted and is being reviewed."}
              </p>
            </div>
          ) : (
            <>
              {/* QA mode */}
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">QA Mode</label>
                <select
                  value={qaMode}
                  onChange={(e) => setQaMode(e.target.value as "standard" | "quick")}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                >
                  <option value="standard">Standard</option>
                  <option value="quick">Quick (minimum photos)</option>
                </select>
              </div>

              {qaMode === "quick" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Min before photos</label>
                    <input
                      type="number"
                      min={1}
                      value={quickMinimumBefore}
                      onChange={(e) => setQuickMinimumBefore(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Min after photos</label>
                    <input
                      type="number"
                      min={1}
                      value={quickMinimumAfter}
                      onChange={(e) => setQuickMinimumAfter(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    />
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                  Completion notes (optional)
                </label>
                <textarea
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  placeholder="Any notes for the reviewer..."
                />
              </div>

              {/* Guest ready */}
              <label className="flex cursor-pointer items-center gap-3">
                <span className={[
                  "flex h-5 w-5 items-center justify-center rounded border text-xs font-bold",
                  guestReady
                    ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "border-[var(--border)] bg-[var(--card)]",
                ].join(" ")}>
                  {guestReady ? "✓" : ""}
                </span>
                <input type="checkbox" checked={guestReady} className="sr-only" onChange={(e) => setGuestReady(e.target.checked)} />
                <span className="text-sm text-[var(--foreground)]">Unit is guest-ready</span>
              </label>

              {/* Submit button */}
              <button
                type="button"
                disabled={submitDisabled}
                onClick={() => void handleSubmit(false)}
                className="w-full rounded-md bg-[var(--primary)] py-3 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pendingSubmit ? "Submitting..." : "Submit for Approval"}
              </button>

              {submitError && (
                <div className="space-y-2 rounded-md border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 p-3">
                  <p className="text-xs text-[var(--destructive)]">{submitError}</p>
                  {canForceSubmit && (
                    <button
                      type="button"
                      disabled={pendingSubmit}
                      onClick={() => void handleSubmit(true)}
                      className="rounded-md border border-[var(--destructive)] px-3 py-1.5 text-xs font-semibold text-[var(--destructive)] hover:opacity-80 disabled:opacity-50"
                    >
                      {pendingSubmit ? "Submitting..." : "Submit Anyway"}
                    </button>
                  )}
                </div>
              )}

              {submitSuccess && (
                <p className="text-center text-xs font-medium text-[var(--success,oklch(0.66_0.18_150))]">
                  {submitSuccess}
                </p>
              )}
            </>
          )}
        </section>
      )}

      {/* ── Navigation footer ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 pb-6">
        <button
          type="button"
          onClick={() => { if (showIncidentPrompt) { setShowIncidentPrompt(false); } else { goBack(); } }}
          disabled={isFirstStep && !showIncidentPrompt}
          className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-5 py-2.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] active:opacity-70 disabled:invisible"
        >
          ← Back
        </button>

        {!isLastStep && !showIncidentPrompt && (
          <button
            type="button"
            onClick={phase === "after_photos" ? () => setShowIncidentPrompt(true) : goNext}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] py-2.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 active:opacity-70"
          >
            Next →
          </button>
        )}

        {(isLastStep || showIncidentPrompt) && <div className="flex-1" />}
      </div>

    </div>
  );
}
