"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  resetFailedUploads,
} from "@/features/cleaner/offline/queue";
import type { DraftIncident, DraftProgress, PendingUpload } from "@/features/cleaner/offline/types";
import { JobConversationPanel } from "@/components/conversations/job-conversation-panel";
import { getErrorMessage } from "@/lib/errors";

// Steps: cleaning step removed — skip is merged into before_photos
type ActivePhase = "before_photos" | "after_photos" | "incidents" | "review";

const STEPS: Array<{ phase: ActivePhase; labelKey: string; shortLabelKey: string }> = [
  { phase: "before_photos", labelKey: "cleaner.active.steps.before.label", shortLabelKey: "cleaner.active.steps.before.short" },
  { phase: "after_photos", labelKey: "cleaner.active.steps.after.label", shortLabelKey: "cleaner.active.steps.after.short" },
  { phase: "incidents", labelKey: "cleaner.active.steps.incidents.label", shortLabelKey: "cleaner.active.steps.incidents.short" },
  { phase: "review", labelKey: "cleaner.active.steps.review.label", shortLabelKey: "cleaner.active.steps.review.short" },
];

// Fallback shown only when property.rooms has not been synced from Hospitable yet.
// Property.rooms is the source of truth — see Docs/cleaner-rollout-and-saas/2026-04-21-property-rooms-from-hospitable-plan.md
const FALLBACK_ROOM_KEYS = [
  "cleaner.rooms.livingRoom",
  "cleaner.rooms.kitchen",
  "cleaner.rooms.bedroom",
  "cleaner.rooms.bathroom",
] as const;

function readRoomName(value: unknown): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildRoomList(detail: JobDetailLike | null | undefined, fallbackRooms: string[]): string[] {
  if (!detail) return [...fallbackRooms];

  const propertyRooms = detail.property?.rooms ?? [];
  const hasPropertyRooms = propertyRooms.length > 0;

  const set = new Set<string>();
  if (hasPropertyRooms) {
    propertyRooms.forEach((room) => {
      const name = readRoomName(room?.name);
      if (name) set.add(name);
    });
  } else {
    fallbackRooms.forEach((name) => set.add(name));
  }

  // Merge in any legacy rooms referenced by existing evidence so in-flight jobs
  // keep their uploaded photos visible even if a room was renamed upstream.
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

function getPhotoUrlsByRoom(args: {
  roomName: string;
  type: "before" | "after";
  detail: JobDetailLike | null | undefined;
  pendingUploads: PendingUpload[];
}): string[] {
  const serverUrls = (args.detail?.evidence?.current?.byType?.[args.type] ?? [])
    .filter((p) => readRoomName((p as { roomName?: unknown }).roomName) === args.roomName)
    .map((p) => (p as { url?: string | null }).url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  const localUrls = args.pendingUploads
    .filter((u) => u.roomName === args.roomName && u.photoType === args.type)
    .map((u) => u.fileDataUrl)
    .filter((u) => u.length > 0);
  return [...serverUrls, ...localUrls];
}

function getPendingUploadPreviews(
  photoRefs: string[],
  pendingUploads: PendingUpload[],
  previewCache: Record<string, string> = {},
): Array<{ photoRef: string; url: string }> {
  return photoRefs
    .map((photoRef) => {
      // Prefer the in-memory cache — it survives the local-id -> server-id
      // swap. Fall back to the pending-uploads queue for backward compat.
      const cached = previewCache[photoRef];
      if (typeof cached === "string" && cached.length > 0) {
        return { photoRef, url: cached };
      }
      const url = pendingUploads.find((upload) => upload.id === photoRef)?.fileDataUrl;
      return typeof url === "string" && url.length > 0 ? { photoRef, url } : null;
    })
    .filter((preview): preview is { photoRef: string; url: string } => preview !== null);
}

type JobDetailLike = {
  job: {
    _id: Id<"cleaningJobs">;
    status: string;
    propertyId: Id<"properties">;
    notesForCleaner?: string;
  };
  property?: {
    name?: string | null;
    address?: string | null;
    rooms?: Array<{ name: string; type: string }> | null;
  } | null;
  evidence: {
    current: {
      byType: {
        before: Array<{ roomName?: string | null; url?: string | null }>;
        after:  Array<{ roomName?: string | null; url?: string | null }>;
        incident: Array<{ roomName?: string | null; url?: string | null }>;
      };
      byRoom: Array<{ roomName?: string | null }>;
    };
  };
};

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepIndicator({
  t,
  currentIndex,
  visitedIndices,
  onGoTo,
}: {
  t: ReturnType<typeof useTranslations>;
  currentIndex: number;
  visitedIndices: Set<number>;
  onGoTo: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
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
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors shadow-[var(--cleaner-shadow)]",
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
                {t(step.shortLabelKey)}
              </span>
            </button>
            {index < STEPS.length - 1 && (
              <div
                className={[
                  "h-0.5 flex-1 rounded-full transition-colors",
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
  t,
  roomName,
  photoCount,
  photoUrls,
  skippedReason,
  onAddFile,
  onSkip,
  onUnskip,
  onPreview,
}: {
  t: ReturnType<typeof useTranslations>;
  roomName: string;
  photoCount: number;
  photoUrls: string[];
  skippedReason: string | undefined;
  onAddFile: (file: File) => Promise<void>;
  onSkip: (reason: string) => void;
  onUnskip: () => void;
  onPreview: (url: string) => void;
}) {
  const [showSkipInput, setShowSkipInput] = useState(false);
  const [skipReason, setSkipReason] = useState("");

  const isSkipped = skippedReason !== undefined;
  const hasPhotos = photoCount > 0;

  if (isSkipped) {
    return (
      <div className="cleaner-card p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">{roomName}</p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {t("cleaner.active.skipped")}{skippedReason ? `: ${skippedReason}` : ""}
            </p>
          </div>
          <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            {t("cleaner.active.skipped")}
          </span>
        </div>
        <button
          type="button"
          onClick={onUnskip}
          className="mt-2 text-xs text-[var(--primary)] underline-offset-2 hover:underline"
        >
          {t("cleaner.active.undoSkip")}
        </button>
      </div>
    );
  }

  return (
    <div className="cleaner-card p-3">
      {/* Room header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[var(--foreground)]">{roomName}</p>
        {hasPhotos ? (
          <span className="text-xs font-semibold text-[var(--success,oklch(0.66_0.18_150))]">
            {t("cleaner.active.photoCount", { count: photoCount })}
          </span>
        ) : (
          <span className="text-xs text-[var(--muted-foreground)]">{t("cleaner.active.noPhotosYet")}</span>
        )}
      </div>

      {/* Photo thumbnails */}
      {photoUrls.length > 0 && (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {photoUrls.map((url, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPreview(url)}
              className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-[var(--border)] active:opacity-70"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Add photo */}
      <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-[12px] border border-dashed border-[var(--border)] py-2.5 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] active:opacity-70">
        <span>{t("cleaner.active.addPhoto")}</span>
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
          {t("cleaner.active.skipRoom")}
        </button>
      )}

      {/* Skip reason form */}
      {showSkipInput && (
        <div className="mt-2 space-y-2 rounded-md border border-[var(--border)] bg-[var(--muted)]/40 p-2">
          <p className="text-xs font-medium text-[var(--foreground)]">{t("cleaner.active.skipReasonOptional")}</p>
          <input
            autoFocus
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            placeholder={t("cleaner.active.skipReasonPlaceholder")}
            className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onSkip(skipReason.trim());
                setSkipReason("");
                setShowSkipInput(false);
              }}
              className="flex-1 rounded-[10px] bg-[var(--primary)] py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
            >
              {t("cleaner.active.confirmSkip")}
            </button>
            <button
              type="button"
              onClick={() => { setShowSkipInput(false); setSkipReason(""); }}
              className="rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)]"
            >
              {t("common.cancel")}
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
  const t = useTranslations();
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
  const generateUploadUrl          = useMutation(api.files.mutations.generateUploadUrl);
  const generateUploadUrlRef       = useRef(generateUploadUrl);
  generateUploadUrlRef.current     = generateUploadUrl;
  const uploadJobPhoto             = useMutation(api.files.mutations.uploadJobPhoto);
  const uploadJobPhotoRef          = useRef(uploadJobPhoto);
  uploadJobPhotoRef.current        = uploadJobPhoto;
  const getExternalUploadUrl       = useMutation(api.files.mutations.getExternalUploadUrl);
  const getExternalUploadUrlRef    = useRef(getExternalUploadUrl);
  getExternalUploadUrlRef.current  = getExternalUploadUrl;
  const completeExternalUpload     = useMutation(api.files.mutations.completeExternalUpload);
  const completeExternalUploadRef  = useRef(completeExternalUpload);
  completeExternalUploadRef.current = completeExternalUpload;
  const deleteJobPhoto             = useMutation(api.files.mutations.deleteJobPhoto);
  const deleteJobPhotoRef          = useRef(deleteJobPhoto);
  deleteJobPhotoRef.current        = deleteJobPhoto;

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
  const [completionNotes, setCompletionNotes]       = useState("");
  const [guestReady, setGuestReady]                 = useState(false);
  const [incidents, setIncidents]                   = useState<DraftIncident[]>([]);

  const [newIncidentTitle, setNewIncidentTitle]             = useState("");
  const [newIncidentDescription, setNewIncidentDescription] = useState("");
  const [newIncidentRoomName, setNewIncidentRoomName]       = useState("");
  const [newIncidentSeverity, setNewIncidentSeverity]       = useState<"low" | "medium" | "high" | "critical">("medium");
  const [newIncidentPhotoIds, setNewIncidentPhotoIds]       = useState<string[]>([]);

  // Offline / sync
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  // Preview cache — survives the pendingUploads -> server photoId swap so the
  // thumbnail in the incident composer doesn't vanish once the upload lands.
  // Keyed by current photoRef (starts as the local upload id, gets migrated to
  // the server photo id on completion).
  const [photoPreviewCache, setPhotoPreviewCache] = useState<Record<string, string>>({});
  const [isOnline, setIsOnline]             = useState(true);
  const [isSyncing, setIsSyncing]           = useState(false);
  const isSyncingRef                        = useRef(false);
  const [syncError, setSyncError]           = useState<string | null>(null);

  // Lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Incident prompt — shown between after_photos and incidents steps
  const [showIncidentPrompt, setShowIncidentPrompt] = useState(false);

  // Submit
  const [pendingSubmit, setPendingSubmit]   = useState(false);
  const [submitError, setSubmitError]       = useState<string | null>(null);
  const [canForceSubmit, setCanForceSubmit] = useState(false);
  const [submitSuccess, setSubmitSuccess]   = useState<string | null>(null);

  const translatedFallbackRooms = useMemo(
    () => FALLBACK_ROOM_KEYS.map((key) => t(key)),
    [t],
  );
  const roomList  = useMemo(() => buildRoomList(detail, translatedFallbackRooms), [detail, translatedFallbackRooms]);
  const syncState = useMemo(
    () => buildSyncState({ queue: pendingUploads, isOnline, isSyncing, lastError: syncError ?? undefined }),
    [isOnline, isSyncing, pendingUploads, syncError],
  );

  const loadJobQueue = useCallback(async () => {
    return (await listPendingUploads()).filter((item) => item.jobId === jobId);
  }, [jobId]);

  // ── Hydrate draft ─────────────────────────────────────────────────────────
  const hydrateLocalState = useCallback(async () => {
    const [rawQueue, draft] = await Promise.all([loadJobQueue(), loadDraftProgress(jobId)]);

    // Reset any uploads stuck in "syncing" from a previous interrupted session.
    // On a fresh page load nothing is actually in-flight, so "syncing" items are
    // orphaned and must be retried — otherwise canSubmit stays false forever.
    const stuckSyncing = rawQueue.filter((u) => u.status === "syncing");
    if (stuckSyncing.length > 0) {
      await Promise.all(
        stuckSyncing.map((item) =>
          upsertPendingUpload({ ...item, status: "pending", lastError: undefined }),
        ),
      );
    }
    const cleanedQueue = rawQueue.map((u) =>
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
      setCompletionNotes(draft.completionNotes);
      setGuestReady(draft.guestReady);
      setIncidents(draft.incidents);
    }
  }, [jobId, loadJobQueue]);

  // ── Upload queue drainer ──────────────────────────────────────────────────
  const queueDrainPromiseRef = useRef<Promise<void> | null>(null);
  const drainQueue = useCallback(async () => {
    if (!isOnline) return;
    if (queueDrainPromiseRef.current) {
      await queueDrainPromiseRef.current;
      return;
    }

    const run = async () => {
      isSyncingRef.current = true;
      setIsSyncing(true);
      setSyncError(null);

      try {
        while (true) {
          let queue = await loadJobQueue();

          if (queue.some((item) => item.status === "failed")) {
            const reset = resetFailedUploads(queue);
            const changed = reset.filter((item) => {
              const prev = queue.find((candidate) => candidate.id === item.id);
              return prev?.status !== item.status || prev?.lastError !== item.lastError;
            });
            await Promise.all(changed.map((item) => upsertPendingUpload(item)));
            queue = await loadJobQueue();
          }

          setPendingUploads(queue);

          const pendingBatch = getNextPendingUploads(queue, queue.length || 1);
          if (pendingBatch.length === 0) {
            if (queue.every((item) => item.status !== "failed")) {
              setSyncError(null);
            }
            break;
          }

          for (const upload of pendingBatch) {
            try {
              const syncingQueue = markUploadSyncing(queue, upload.id);
              const syncing = syncingQueue.find((item) => item.id === upload.id);
              if (!syncing) {
                queue = await loadJobQueue();
                setPendingUploads(queue);
                continue;
              }

              await upsertPendingUpload(syncing);
              queue = await loadJobQueue();
              setPendingUploads(queue);

              const blob = dataUrlToBlob(syncing.fileDataUrl);
              const contentType = syncing.mimeType || "image/jpeg";

              let photoId: Id<"photos">;
              try {
                // Try B2 external storage first.
                // Note: getExternalUploadUrl returns a discriminated union
                // since the Phase 1 video-support change. We don't pass
                // `mediaKind` here so we get the image branch; narrow
                // explicitly so TS sees `url` / `objectKey` as defined.
                const ticket = await getExternalUploadUrlRef.current({
                  jobId,
                  roomName: syncing.roomName,
                  photoType: syncing.photoType,
                  source: "app",
                  contentType,
                  fileName: `${syncing.photoType}-${Date.now()}.jpg`,
                  byteSize: blob.size,
                });
                if (ticket.mediaKind !== "image") {
                  throw new Error(
                    "Unexpected video upload ticket on the image upload path",
                  );
                }

                const putRes = await fetch(ticket.url, {
                  method: "PUT",
                  headers: { "Content-Type": contentType },
                  body: blob,
                });
                if (!putRes.ok) throw new Error(`B2 upload failed (${putRes.status}).`);

                const completion = await completeExternalUploadRef.current({
                  jobId,
                  roomName: syncing.roomName,
                  photoType: syncing.photoType,
                  source: "app",
                  provider: ticket.provider,
                  bucket: ticket.bucket,
                  objectKey: ticket.objectKey,
                  contentType,
                  byteSize: blob.size,
                });
                photoId = completion.photoId;
              } catch {
                // Fallback to legacy Convex storage
                const uploadUrl = await generateUploadUrlRef.current({});
                const res = await fetch(uploadUrl, {
                  method: "POST",
                  headers: { "Content-Type": contentType },
                  body: blob,
                });
                if (!res.ok) throw new Error(`File upload failed (${res.status}).`);

                const payload = (await res.json()) as { storageId?: Id<"_storage"> };
                if (!payload.storageId) throw new Error("Upload response missing storageId.");

                photoId = await uploadJobPhotoRef.current({
                  storageId: payload.storageId,
                  jobId,
                  roomName: syncing.roomName,
                  photoType: syncing.photoType,
                  source: "app",
                  notes: undefined,
                });
              }

              setIncidents((current) =>
                current.map((incident) => ({
                  ...incident,
                  localPhotoIds: incident.localPhotoIds.map((photoRef) =>
                    photoRef === syncing.id ? String(photoId) : photoRef,
                  ),
                })),
              );
              setNewIncidentPhotoIds((current) =>
                current.map((photoRef) => (photoRef === syncing.id ? String(photoId) : photoRef)),
              );

              // Carry the preview blob under the new server photo id so the
              // composer thumbnail stays visible after the upload completes.
              setPhotoPreviewCache((current) => {
                const blob = current[syncing.id];
                if (!blob) return current;
                const next = { ...current };
                next[String(photoId)] = blob;
                delete next[syncing.id];
                return next;
              });

              await deletePendingUpload(syncing.id);
              queue = await loadJobQueue();
              setPendingUploads(queue);
            } catch (error) {
              const message = getErrorMessage(error, "Queue sync failed.");
              const failedQueue = markUploadFailed(queue, upload.id, message);
              const failed = failedQueue.find((item) => item.id === upload.id);
              if (failed) {
                await upsertPendingUpload(failed);
              }
              queue = await loadJobQueue();
              setPendingUploads(queue);
              setSyncError(message);
            }
          }
        }
      } finally {
        const finalQueue = await loadJobQueue();
        setPendingUploads(finalQueue);
        if (finalQueue.every((item) => item.status !== "failed")) {
          setSyncError(null);
        }
        isSyncingRef.current = false;
        setIsSyncing(false);
      }
    };

    const promise = run().finally(() => {
      queueDrainPromiseRef.current = null;
    });
    queueDrainPromiseRef.current = promise;
    await promise;
  }, [isOnline, jobId, loadJobQueue]);

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

  // Derive status once so effects depend on the scalar, not the full detail object.
  // This prevents loops where startJob/pingActiveSession update a field inside
  // detail, which re-fires the effect, which calls the mutation again, ad infinitum.
  const jobStatus = detail?.job.status;

  const hasStartedJobRef = useRef(false);
  useEffect(() => {
    if (!jobStatus) return;
    if (jobStatus === "awaiting_approval" || jobStatus === "completed" || jobStatus === "cancelled") {
      goToStep(STEPS.length - 1);
      setPendingSubmit(false);
      return;
    }
    // Only call startJob once per page load — it is not idempotent and calling
    // it on every detail update causes an infinite Convex mutation loop.
    if (!hasStartedJobRef.current) {
      hasStartedJobRef.current = true;
      void startJobRef.current({
        jobId,
        startedAtDevice: Date.now(),
        offlineStartToken: `${jobId}-${Date.now()}`,
      }).catch((e) => { console.warn("[CleanerActiveJob] start failed", e); });
    }
  }, [jobStatus, jobId]);

  useEffect(() => {
    if (jobStatus !== "in_progress") return;
    // Depend only on jobStatus (scalar), not on detail, so that pingActiveSession
    // updating any field in the detail query does not re-trigger this effect and
    // cause send() to be called in a tight loop (billing issue).
    const send = () => { void pingActiveSessionRef.current({ jobId }).catch((e: unknown) => { console.warn("[CleanerActiveJob] heartbeat failed", e); }); };
    send();
    const timer = window.setInterval(send, 30_000);
    return () => { window.clearInterval(timer); };
  }, [jobStatus, jobId]);

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
      qaMode: "standard",
      quickMinimumBefore: 2,
      quickMinimumAfter: 2,
      requiredRooms: roomList,
      completionNotes,
      guestReady,
      incidents,
      updatedAt: Date.now(),
    };
    void saveDraftProgress(draft);
  }, [completionNotes, guestReady, incidents, jobId, phase, roomList, skippedRooms, detail]);

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
      setPhotoPreviewCache((current) => ({ ...current, [upload.id]: fileDataUrl }));
      if (isOnline) void drainQueue();
      return upload.id;
    },
    [drainQueue, isOnline, jobId],
  );

  const removeIncidentPhotoRef = useCallback(
    async (photoRef: string) => {
      setPhotoPreviewCache((current) => {
        if (!(photoRef in current)) return current;
        const next = { ...current };
        delete next[photoRef];
        return next;
      });

      const pendingUpload = pendingUploads.find((upload) => upload.id === photoRef);
      if (pendingUpload) {
        await deletePendingUpload(photoRef);
        setPendingUploads((current) => current.filter((upload) => upload.id !== photoRef));
        return;
      }

      try {
        await deleteJobPhotoRef.current({ photoId: photoRef as Id<"photos"> });
      } catch (error) {
        console.warn("[CleanerActiveJob] failed to delete incident photo", error);
      }
    },
    [pendingUploads],
  );

  const removeIncident = useCallback(
    async (incidentId: string) => {
      const incident = incidents.find((item) => item.id === incidentId);
      if (!incident) {
        return;
      }

      await Promise.all(incident.localPhotoIds.map((photoRef) => removeIncidentPhotoRef(photoRef)));
      setIncidents((current) => current.filter((item) => item.id !== incidentId));
    },
    [incidents, removeIncidentPhotoRef],
  );

  // ── Guards ────────────────────────────────────────────────────────────────
  if (isLoading || !isAuthenticated || detail === undefined) {
    return <p className="p-4 text-sm text-[var(--muted-foreground)]">{t("cleaner.active.loading")}</p>;
  }
  if (!detail) {
    return <p className="p-4 text-sm text-[var(--muted-foreground)]">{t("cleaner.active.notFound")}</p>;
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
      if (!isOnline) {
        throw new Error(t("cleaner.active.mustBeOnlineToSubmit"));
      }

      await drainQueueRef.current();

      const queueSnapshot = await loadJobQueue();
      const pendingQueueCount = queueSnapshot.filter(
        (item) => item.status === "pending" || item.status === "syncing",
      ).length;
      const failedQueueCount = queueSnapshot.filter((item) => item.status === "failed").length;

      if (pendingQueueCount > 0 || isSyncingRef.current) {
        throw new Error(t("cleaner.active.uploadsStillSyncing"));
      }
      if (failedQueueCount > 0) {
        throw new Error(t("cleaner.active.uploadsFailed"));
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
          photoIds: incident.localPhotoIds as Id<"photos">[],
        });
      }

      const result = (await submitForApproval({
        jobId,
        notes: completionNotes.trim() || undefined,
        guestReady,
        qaMode: "standard",
        requiredRooms: roomList,
        skippedRooms: skippedRooms.length > 0 ? skippedRooms : undefined,
        submittedAtDevice: Date.now(),
        ...(force ? { force: true } : {}),
      })) as { ok?: boolean; unresolvedCleanerIds?: string[] };

      if (result?.ok === false) {
        throw new Error(
          t("cleaner.active.cannotSubmitUnresolved", { count: result.unresolvedCleanerIds?.length ?? 0 }),
        );
      }

      await clearDraftProgress(jobId);
      setSubmitSuccess(t("cleaner.active.submittedSuccess"));
      router.push(`/cleaner/jobs/${jobId}`);
    } catch (error) {
      const msg = getErrorMessage(error, t("cleaner.active.submitErrorDefault"));
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
          {detail.property?.name ?? t("cleaner.unknownProperty")}
        </h2>
        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
          {detail.property?.address ?? t("cleaner.noAddress")}
        </p>
        {detail.job.notesForCleaner ? (
          <p className="mt-2 rounded-md bg-[var(--warning)]/15 px-2 py-1.5 text-xs text-[var(--warning-foreground,var(--foreground))]">
            {detail.job.notesForCleaner}
          </p>
        ) : null}
      </section>

      <JobConversationPanel
        jobId={jobId}
        fullHrefBase="/cleaner/messages"
        compact
      />

      <SyncBanner syncState={syncState} />

      {/* Step indicator */}
      <section className="rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <StepIndicator
          t={t}
          currentIndex={currentStepIndex}
          visitedIndices={visitedIndices}
          onGoTo={goToStep}
        />
        <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">
          {t("cleaner.active.stepOf", { current: currentStepIndex + 1, total: STEPS.length })} -{" "}
          <span className="font-medium text-[var(--foreground)]">{t(STEPS[currentStepIndex].labelKey)}</span>
        </p>
      </section>

      {/* ── STEP: Before / After photos ─────────────────────────────────── */}
      {(phase === "before_photos" || phase === "after_photos") && !showIncidentPrompt && (
        <section className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">
              {phase === "before_photos" ? t("cleaner.active.beforePhotos") : t("cleaner.active.afterPhotos")}
            </h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {phase === "before_photos"
                ? t("cleaner.active.beforeHint")
                : t("cleaner.active.afterHint")}
            </p>
          </div>

          <div className="space-y-2">
            {roomList.map((roomName) => {
              const photoType = phase === "before_photos" ? "before" : "after";
              const count = getCountByRoom({ roomName, type: photoType, detail, pendingUploads });
              const urls = getPhotoUrlsByRoom({ roomName, type: photoType, detail, pendingUploads });
              const skippedEntry = skippedRooms.find((r) => r.roomName === roomName);

              return (
                <RoomPhotoCard
                  t={t}
                  key={roomName}
                  roomName={roomName}
                  photoCount={count}
                  photoUrls={urls}
                  skippedReason={phase === "before_photos" ? skippedEntry?.reason : undefined}
                  onAddFile={async (file) => {
                    await addUploadFromFile({ file, roomName, photoType });
                  }}
                  onSkip={(reason) => {
                    setSkippedRooms((current) => {
                      const next = current.filter((r) => r.roomName !== roomName);
                      return [...next, { roomName, reason }];
                    });
                  }}
                  onUnskip={() => {
                    setSkippedRooms((current) => current.filter((r) => r.roomName !== roomName));
                  }}
                  onPreview={setLightboxUrl}
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
          <h3 className="text-base font-semibold text-[var(--foreground)]">{t("cleaner.active.incidentPromptTitle")}</h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t("cleaner.active.incidentPromptDescription")}
          </p>
          <div className="flex flex-col gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setShowIncidentPrompt(false); goToStep(STEPS.findIndex((s) => s.phase === "incidents")); }}
              className="w-full rounded-md border border-[var(--destructive)]/50 bg-[var(--destructive)]/10 py-3 text-sm font-semibold text-[var(--destructive)] hover:bg-[var(--destructive)]/20 active:opacity-70"
            >
              {t("cleaner.active.yesReportIncident")}
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
              {t("cleaner.active.noSkipToReview")}
            </button>
          </div>
        </section>
      )}

      {/* ── STEP: Incidents ──────────────────────────────────────────────── */}
      {phase === "incidents" && (
        <section className="space-y-4 rounded-md border border-[var(--border)] bg-[var(--card)] p-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">{t("cleaner.active.reportIncidents")}</h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {t("cleaner.active.incidentsHint")}
            </p>
          </div>

          <div className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
            <input
              value={newIncidentTitle}
              onChange={(e) => setNewIncidentTitle(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              placeholder={t("cleaner.active.incidentTitlePlaceholder")}
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={newIncidentRoomName}
                onChange={(e) => setNewIncidentRoomName(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              >
                <option value="">{t("cleaner.active.incidentRoomOptional")}</option>
                {roomList.map((roomName) => (
                  <option key={roomName} value={roomName}>
                    {roomName}
                  </option>
                ))}
              </select>
              <select
                value={newIncidentSeverity}
                onChange={(e) => setNewIncidentSeverity(e.target.value as "low" | "medium" | "high" | "critical")}
                className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              >
                <option value="low">{t("cleaner.active.severity.low")}</option>
                <option value="medium">{t("cleaner.active.severity.medium")}</option>
                <option value="high">{t("cleaner.active.severity.high")}</option>
                <option value="critical">{t("cleaner.active.severity.critical")}</option>
              </select>
            </div>
            <textarea
              value={newIncidentDescription}
              onChange={(e) => setNewIncidentDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              placeholder={t("cleaner.active.incidentDescriptionOptional")}
            />
            <div className="space-y-2 rounded-md border border-dashed border-[var(--border)] bg-[var(--card)]/40 p-3">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]">
                <span className="text-sm font-medium text-[var(--foreground)]">{t("cleaner.active.addPhotos")}</span>
                <span>{t("cleaner.active.addIncidentPhotoHint")}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="sr-only"
                  onChange={async (event) => {
                    const files = event.target.files;
                    if (!files || files.length === 0) return;

                    // Fall back to a translated "Incident" label rather than
                    // the key "cleaner.incident" — that key resolves to an
                    // object (nested strings), so calling t() on it returned
                    // the literal key and leaked "cleaner.incident" as a room
                    // name into the after-photos step.
                    const roomName = newIncidentRoomName.trim() || t("cleaner.incidentNav");
                    const addedPhotoIds: string[] = [];

                    for (const file of Array.from(files)) {
                      const uploadId = await addUploadFromFile({ file, roomName, photoType: "incident" });
                      addedPhotoIds.push(uploadId);
                    }

                    setNewIncidentPhotoIds((current) => [...current, ...addedPhotoIds]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              {newIncidentPhotoIds.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {t("cleaner.active.photoCountSelected", { count: newIncidentPhotoIds.length })}
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {getPendingUploadPreviews(newIncidentPhotoIds, pendingUploads, photoPreviewCache).map(({ photoRef, url }, index) => {
                      return (
                        <div key={`${photoRef}-${index}`} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-[var(--border)]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={t("cleaner.active.incidentPreviewAlt", { index: index + 1 })} className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => {
                              void removeIncidentPhotoRef(photoRef);
                              setNewIncidentPhotoIds((current) => current.filter((id) => id !== photoRef));
                            }}
                            className="absolute right-1 top-1 rounded bg-black/65 px-1 text-[10px] text-white"
                            aria-label={t("cleaner.active.removeIncidentPhoto", { index: index + 1 })}
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {getPendingUploadPreviews(newIncidentPhotoIds, pendingUploads, photoPreviewCache).length < newIncidentPhotoIds.length && (
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      {t("cleaner.active.somePhotosAlreadyAttached")}
                    </p>
                  )}
                </div>
              )}
            </div>
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
                    localPhotoIds: newIncidentPhotoIds,
                  },
                ]);
                setNewIncidentTitle("");
                setNewIncidentDescription("");
                setNewIncidentRoomName("");
                setNewIncidentPhotoIds([]);
              }}
            >
              {t("cleaner.active.addIncident")}
            </button>
          </div>

          {incidents.length > 0 && (
            <ul className="space-y-2">
              {incidents.map((incident) => (
                <li key={incident.id} className="flex items-start justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] p-3 text-xs">
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">{incident.title}</p>
                    <p className="mt-0.5 text-[var(--muted-foreground)]">
                      {incident.roomName ?? t("cleaner.active.noRoom")} · <span className="capitalize">{t(`cleaner.active.severity.${incident.severity}`)}</span>
                    </p>
                    {incident.description && (
                      <p className="mt-1 text-[var(--muted-foreground)]">{incident.description}</p>
                    )}
                    {incident.localPhotoIds.length > 0 && (
                      <p className="mt-1 text-[var(--muted-foreground)]">
                        {t("cleaner.active.photoCountAttached", { count: incident.localPhotoIds.length })}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-[var(--destructive)] hover:opacity-80"
                    onClick={() => { void removeIncident(incident.id); }}
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
          <h3 className="text-sm font-semibold text-[var(--foreground)]">{t("cleaner.active.reviewAndSubmit")}</h3>

          {/* Summary counts */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: t("cleaner.active.before"), value: currentBeforeTotal },
              { label: t("cleaner.active.after"), value: currentAfterTotal },
              { label: t("cleaner.active.incidents"), value: incidents.length },
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

          {/* Per-room before/after photo preview */}
          {roomList.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {t("cleaner.active.beforeAfterPhotos")}
              </p>
              {roomList.map((roomName) => {
                const beforeUrls = getPhotoUrlsByRoom({ roomName, type: "before", detail, pendingUploads });
                const afterUrls  = getPhotoUrlsByRoom({ roomName, type: "after",  detail, pendingUploads });
                const skipped = skippedRooms.find((r) => r.roomName === roomName);
                if (skipped) {
                  return (
                    <div key={roomName} className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2">
                      <p className="text-xs font-medium text-[var(--foreground)]">{roomName}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{t("cleaner.active.skipped")}{skipped.reason ? `: ${skipped.reason}` : ""}</p>
                    </div>
                  );
                }
                return (
                  <div key={roomName} className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
                    <p className="mb-2 text-xs font-medium text-[var(--foreground)]">{roomName}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="mb-1 text-[10px] text-[var(--muted-foreground)]">{t("cleaner.active.before")} ({beforeUrls.length})</p>
                        {beforeUrls.length > 0 ? (
                          <div className="flex gap-1 overflow-x-auto">
                            {beforeUrls.map((url, i) => (
                              <button key={i} type="button" onClick={() => setLightboxUrl(url)}
                                className="h-14 w-14 shrink-0 overflow-hidden rounded border border-[var(--border)] active:opacity-70">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt="" className="h-full w-full object-cover" />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="flex h-14 items-center justify-center rounded border border-dashed border-[var(--border)] text-[10px] text-[var(--muted-foreground)]">
                            {t("cleaner.active.none")}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="mb-1 text-[10px] text-[var(--muted-foreground)]">{t("cleaner.active.after")} ({afterUrls.length})</p>
                        {afterUrls.length > 0 ? (
                          <div className="flex gap-1 overflow-x-auto">
                            {afterUrls.map((url, i) => (
                              <button key={i} type="button" onClick={() => setLightboxUrl(url)}
                                className="h-14 w-14 shrink-0 overflow-hidden rounded border border-[var(--border)] active:opacity-70">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt="" className="h-full w-full object-cover" />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="flex h-14 items-center justify-center rounded border border-dashed border-[var(--border)] text-[10px] text-[var(--muted-foreground)]">
                            {t("cleaner.active.none")}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Already submitted — show status banner instead of submit form */}
          {(detail?.job.status === "awaiting_approval" || detail?.job.status === "completed") ? (
            <div className="rounded-md border border-[var(--warning,oklch(0.75_0.15_80))]/40 bg-[var(--warning,oklch(0.75_0.15_80))]/10 p-3 text-center">
              <p className="text-sm font-semibold text-[var(--foreground)]">
                {detail.job.status === "completed" ? t("cleaner.active.jobApproved") : t("cleaner.active.awaitingApproval")}
              </p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                {detail.job.status === "completed"
                  ? t("cleaner.active.jobApprovedHint")
                  : t("cleaner.active.awaitingApprovalHint")}
              </p>
            </div>
          ) : (
            <>
              {/* Notes */}
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
                  {t("cleaner.active.completionNotesOptional")}
                </label>
                <textarea
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  placeholder={t("cleaner.active.completionNotesPlaceholder")}
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
                <span className="text-sm text-[var(--foreground)]">{t("cleaner.active.unitGuestReady")}</span>
              </label>

              {/* Submit button */}
              <button
                type="button"
                disabled={submitDisabled}
                onClick={() => void handleSubmit(false)}
                className="w-full rounded-md bg-[var(--primary)] py-3 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pendingSubmit ? t("cleaner.active.submitting") : t("cleaner.active.submitForApproval")}
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
                      {pendingSubmit ? t("cleaner.active.submitting") : t("cleaner.active.submitAnyway")}
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
          {t("cleaner.active.back")}
        </button>

        {!isLastStep && !showIncidentPrompt && (
          <button
            type="button"
            onClick={phase === "after_photos" ? () => setShowIncidentPrompt(true) : goNext}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] py-2.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 active:opacity-70"
          >
            {t("cleaner.active.next")}
          </button>
        )}

        {(isLastStep || showIncidentPrompt) && <div className="flex-1" />}
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
            aria-label={t("common.close")}
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt=""
            className="max-h-[90dvh] max-w-[90dvw] rounded object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

    </div>
  );
}
