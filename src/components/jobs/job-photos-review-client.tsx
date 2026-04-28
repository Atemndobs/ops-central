"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { ArrowDownAZ, Filter, Search } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useToast } from "@/components/ui/toast-provider";
import { MediaThumbnail } from "@/components/media/MediaThumbnail";
import { VideoPlayer } from "@/components/media/VideoPlayer";
import { getErrorMessage } from "@/lib/errors";
import { ENABLE_VIDEO } from "@/lib/feature-flags";
import { STATUS_CLASSNAMES, STATUS_LABELS } from "@/components/jobs/job-status";

type ReviewVerdict = "pass" | "rework" | null;
type ReviewFilter = "all" | "needs_review" | "missing" | "reviewed";
type MobileReviewControlPanel = "search" | "filter" | "sort" | null;
type RoomReviewState = {
  verdict: ReviewVerdict;
  note: string;
};
type SortMode = "checklist" | "az";

type EvidencePhoto = {
  photoId: Id<"photos">;
  roomName: string;
  type: "before" | "after" | "incident";
  url: string | null;
  uploadedAt?: number | null;
  // Phase 3 of video-support — present on backend rows after the
  // `cleaningJobs/queries.ts` extension. Undefined ≡ "image" so legacy
  // rows still render unchanged.
  mediaKind?: "image" | "video";
  posterUrl?: string | null;
  durationMs?: number;
};

type RoomRow = {
  key: string;
  roomName: string;
  before: EvidencePhoto[];
  after: EvidencePhoto[];
  incidents: EvidencePhoto[];
  hasMissingBefore: boolean;
  hasMissingAfter: boolean;
  hasCountMismatch: boolean;
  firstSeenOrder: number;
};

type ViewerSlide = {
  key: string;
  photoId: Id<"photos">;
  photoKey: string;
  roomName: string;
  type: "before" | "after" | "incident";
  url: string;
  uploadedAt?: number | null;
  // Phase 3 of video-support. Image slides ignore these.
  mediaKind?: "image" | "video";
  posterUrl?: string | null;
  durationMs?: number;
};

type ViewerState = {
  slides: ViewerSlide[];
  index: number;
};

type AnnotationPoint = {
  x: number;
  y: number;
};

type CircleAnnotation = {
  kind: "circle";
  x: number;
  y: number;
  r: number;
  color: string;
};

type FreehandAnnotation = {
  kind: "freehand";
  points: AnnotationPoint[];
  color: string;
};

type LineAnnotation = {
  kind: "line";
  from: AnnotationPoint;
  to: AnnotationPoint;
  color: string;
};

type ArrowAnnotation = {
  kind: "arrow";
  from: AnnotationPoint;
  to: AnnotationPoint;
  color: string;
};

type CloudAnnotation = {
  kind: "cloud";
  from: AnnotationPoint;
  to: AnnotationPoint;
  color: string;
};

type ReviewShape =
  | CircleAnnotation
  | FreehandAnnotation
  | LineAnnotation
  | ArrowAnnotation
  | CloudAnnotation;

type AnnotationTool = "freehand" | "line" | "arrow" | "cloud" | "circle";

type DraftShape =
  | {
      kind: "freehand";
      points: AnnotationPoint[];
    }
  | {
      kind: "line" | "arrow" | "cloud" | "circle";
      from: AnnotationPoint;
      to: AnnotationPoint;
    };

const reviewAnnotationsQuery = makeFunctionReference<
  "query",
  {
    photoIds: Id<"photos">[];
  },
  Array<{
    photoId: Id<"photos">;
    shapes: ReviewShape[];
    updatedAt: number | null;
  }>
>("reviewAnnotations/queries:getForPhotos");

const reviewAnnotationsMutation = makeFunctionReference<
  "mutation",
  {
    photoId: Id<"photos">;
    shapes: ReviewShape[];
  },
  {
    ok: boolean;
    shapeCount: number;
    updatedAt: number;
  }
>("reviewAnnotations/mutations:saveForPhoto");

function formatDateTime(value?: number | null) {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

function formatPhotoTimestamp(value: number): string {
  const d = new Date(value);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function normalizeRoomKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "unspecified";
  }
  return trimmed.toLowerCase().replace(/\s+/g, " ");
}

function cleanRoomName(value: string) {
  return value.trim() || "Unspecified";
}

function buildRejectionReason({
  rows,
  reviewByRoom,
}: {
  rows: RoomRow[];
  reviewByRoom: Record<string, RoomReviewState>;
}) {
  const reworkRooms: string[] = [];
  const roomNotes: string[] = [];

  rows.forEach((row) => {
    const state = reviewByRoom[row.key];
    if (!state) {
      return;
    }
    if (state.verdict === "rework") {
      reworkRooms.push(row.roomName);
    }
    if (state.note.trim()) {
      roomNotes.push(`${row.roomName}: ${state.note.trim()}`);
    }
  });

  const reasonParts: string[] = [];
  if (reworkRooms.length > 0) {
    reasonParts.push(`Rooms marked for rework: ${reworkRooms.join(", ")}`);
  }
  if (roomNotes.length > 0) {
    reasonParts.push(`Room notes: ${roomNotes.join(" | ")}`);
  }
  if (reasonParts.length === 0) {
    return "Submission rejected from photo review.";
  }
  return reasonParts.join(". ");
}

function buildRoomReviewSnapshot(
  rows: RoomRow[],
  reviewByRoom: Record<string, RoomReviewState>,
) {
  return rows.flatMap((row) => {
    const review = reviewByRoom[row.key];
    if (!review?.verdict) {
      return [];
    }
    return [
      {
        roomName: row.roomName,
        verdict: review.verdict,
        note: review.note.trim() || undefined,
      },
    ];
  });
}

function buildViewerSlides(photos: EvidencePhoto[]): ViewerSlide[] {
  return photos.flatMap((photo, index) => {
    if (!photo.url) {
      return [];
    }
    // Master kill-switch: when video is disabled, skip video slides so they
    // don't appear in the lightbox carousel. Mirrors the parent gallery
    // filter — see `src/lib/feature-flags.ts`.
    if (!ENABLE_VIDEO && photo.mediaKind === "video") {
      return [];
    }
    return [
      {
        key: `${photo.photoId}-${index}`,
        photoId: photo.photoId,
        photoKey: String(photo.photoId),
        roomName: cleanRoomName(photo.roomName),
        type: photo.type,
        url: photo.url,
        uploadedAt: photo.uploadedAt,
        mediaKind: photo.mediaKind,
        posterUrl: photo.posterUrl,
        durationMs: photo.durationMs,
      },
    ];
  });
}

function normalizedNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(4));
}

function shapeSignature(shape: ReviewShape): string {
  if (shape.kind === "circle") {
    return `circle:${normalizedNumber(shape.x)}:${normalizedNumber(shape.y)}:${normalizedNumber(shape.r)}:${shape.color}`;
  }
  if (shape.kind === "freehand") {
    const points = shape.points
      .map((point) => `${normalizedNumber(point.x)},${normalizedNumber(point.y)}`)
      .join("|");
    return `freehand:${points}:${shape.color}`;
  }
  return `${shape.kind}:${normalizedNumber(shape.from.x)}:${normalizedNumber(shape.from.y)}:${normalizedNumber(shape.to.x)}:${normalizedNumber(shape.to.y)}:${shape.color}`;
}

function areShapesEqual(left: ReviewShape[], right: ReviewShape[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((shape, index) => shapeSignature(shape) === shapeSignature(right[index]));
}

export function JobPhotosReviewClient({ id }: { id: string }) {
  const { isAuthenticated } = useConvexAuth();
  const jobId = id as Id<"cleaningJobs">;
  const { showToast } = useToast();

  const detail = useQuery(api.cleaningJobs.queries.getJobDetail, isAuthenticated ? { jobId } : "skip");
  const approveCompletion = useMutation(api.cleaningJobs.approve.approveCompletion);
  const rejectCompletion = useMutation(api.cleaningJobs.approve.rejectCompletion);
  const savePhotoReviewAnnotations = useMutation(reviewAnnotationsMutation);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("checklist");
  const [mobileControlPanel, setMobileControlPanel] =
    useState<MobileReviewControlPanel>(null);
  const [reviewByRoom, setReviewByRoom] = useState<Record<string, RoomReviewState>>({});
  const [notesOpenByRoom, setNotesOpenByRoom] = useState<Record<string, boolean>>({});
  const [compareRoomKey, setCompareRoomKey] = useState<string | null>(null);
  const [compareBeforeIndex, setCompareBeforeIndex] = useState(0);
  const [compareAfterIndex, setCompareAfterIndex] = useState(0);
  const [compareLinked, setCompareLinked] = useState(true);
  const [pendingDecision, setPendingDecision] = useState<"approve" | "reject" | null>(null);
  const [activeRoomKey, setActiveRoomKey] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [annotateEnabled, setAnnotateEnabled] = useState(false);
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>("freehand");
  const [annotationColor, setAnnotationColor] = useState("#ef4444");
  const [annotationsByPhoto, setAnnotationsByPhoto] = useState<Record<string, ReviewShape[]>>(
    {},
  );
  const [dirtyByPhoto, setDirtyByPhoto] = useState<Record<string, boolean>>({});
  const [savingPhotoKey, setSavingPhotoKey] = useState<string | null>(null);
  const [isDrawingShape, setIsDrawingShape] = useState(false);
  const [draftShape, setDraftShape] = useState<DraftShape | null>(null);
  const viewerCanvasRef = useRef<HTMLDivElement | null>(null);

  const rawCurrentPhotos = detail?.evidence.current.byType.all ?? [];
  const rawLatestSubmissionPhotos = detail?.evidence.latestSubmission?.photos ?? [];
  // Master kill-switch — drop video rows at the source so every gallery,
  // grid, and the lightbox carousel see only images. Mirrors the mobile
  // `EXPO_PUBLIC_ENABLE_VIDEO_CAPTURE` flag. See `src/lib/feature-flags.ts`.
  const currentPhotosAll = ENABLE_VIDEO
    ? rawCurrentPhotos
    : rawCurrentPhotos.filter((p) => (p.mediaKind ?? "image") !== "video");
  const latestSubmissionPhotos = ENABLE_VIDEO
    ? rawLatestSubmissionPhotos
    : rawLatestSubmissionPhotos.filter(
        (p) => (p.mediaKind ?? "image") !== "video",
      );
  const evidencePhotos = currentPhotosAll.length
    ? (currentPhotosAll as EvidencePhoto[])
    : (latestSubmissionPhotos as EvidencePhoto[]);
  const photoIdsForAnnotations = useMemo(
    () => [...new Set(evidencePhotos.map((photo) => photo.photoId))],
    [evidencePhotos],
  );
  const persistedAnnotations = useQuery(
    reviewAnnotationsQuery,
    photoIdsForAnnotations.length > 0 ? { photoIds: photoIdsForAnnotations } : "skip",
  );
  const fallbackInUse = currentPhotosAll.length === 0 && latestSubmissionPhotos.length > 0;

  const roomRows = useMemo(() => {
    const roomMap = new Map<string, RoomRow>();

    evidencePhotos.forEach((photo, index) => {
      const key = normalizeRoomKey(photo.roomName);
      const row = roomMap.get(key) ?? {
        key,
        roomName: cleanRoomName(photo.roomName),
        before: [],
        after: [],
        incidents: [],
        hasMissingBefore: false,
        hasMissingAfter: false,
        hasCountMismatch: false,
        firstSeenOrder: index,
      };

      if (photo.type === "before") row.before.push(photo);
      if (photo.type === "after") row.after.push(photo);
      if (photo.type === "incident") row.incidents.push(photo);

      roomMap.set(key, row);
    });

    return Array.from(roomMap.values()).map((row) => {
      const hasMissingBefore = row.before.length === 0;
      const hasMissingAfter = row.after.length === 0;
      return {
        ...row,
        hasMissingBefore,
        hasMissingAfter,
        hasCountMismatch: row.before.length !== row.after.length,
      };
    });
  }, [evidencePhotos]);

  const compareRow = useMemo(
    () => roomRows.find((row) => row.key === compareRoomKey) ?? null,
    [compareRoomKey, roomRows],
  );

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    let next = [...roomRows];

    next = next.filter((row) => {
      if (query && !row.roomName.toLowerCase().includes(query)) {
        return false;
      }
      const state = reviewByRoom[row.key];
      const verdict = state?.verdict ?? null;
      const missing = row.hasMissingBefore || row.hasMissingAfter || row.hasCountMismatch;

      if (filter === "needs_review") return verdict === null;
      if (filter === "reviewed") return verdict !== null;
      if (filter === "missing") return missing;
      return true;
    });

    next.sort((a, b) => {
      if (sortMode === "az") {
        return a.roomName.localeCompare(b.roomName);
      }
      if (a.firstSeenOrder === b.firstSeenOrder) {
        return a.roomName.localeCompare(b.roomName);
      }
      return a.firstSeenOrder - b.firstSeenOrder;
    });

    return next;
  }, [filter, reviewByRoom, roomRows, search, sortMode]);

  const incidentPhotos = useMemo(
    () => evidencePhotos.filter((photo) => photo.type === "incident"),
    [evidencePhotos],
  );

  const totalRooms = roomRows.length;
  const reviewedCount = roomRows.filter((row) => reviewByRoom[row.key]?.verdict !== null).length;
  const passCount = roomRows.filter((row) => reviewByRoom[row.key]?.verdict === "pass").length;
  const reworkCount = roomRows.filter((row) => reviewByRoom[row.key]?.verdict === "rework").length;
  const reviewPercent = totalRooms === 0 ? 0 : Math.round((reviewedCount / totalRooms) * 100);
  const allReviewed = totalRooms > 0 && reviewedCount === totalRooms;
  const canDecision = detail?.job.status === "awaiting_approval";
  const isReadOnlyReview = !canDecision;

  const currentSlide = viewer ? viewer.slides[viewer.index] : null;
  const currentAnnotations = currentSlide ? (annotationsByPhoto[currentSlide.photoKey] ?? []) : [];
  const isCurrentPhotoDirty = currentSlide
    ? Boolean(dirtyByPhoto[currentSlide.photoKey])
    : false;

  // Compare canvas derived values
  const compareRoomIdx = visibleRows.findIndex((r) => r.key === compareRoomKey);
  const prevCompareRoom = compareRoomIdx > 0 ? visibleRows[compareRoomIdx - 1] : null;
  const nextCompareRoom =
    compareRoomIdx >= 0 && compareRoomIdx < visibleRows.length - 1
      ? visibleRows[compareRoomIdx + 1]
      : null;
  const compareBeforePhoto = compareRow?.before[compareBeforeIndex] ?? null;
  const compareAfterPhoto = compareRow?.after[compareAfterIndex] ?? null;

  useEffect(() => {
    if (persistedAnnotations === undefined) {
      return;
    }

    setAnnotationsByPhoto((previous) => {
      const next = { ...previous };
      let changed = false;

      persistedAnnotations.forEach((item) => {
        const photoKey = String(item.photoId);
        if (dirtyByPhoto[photoKey]) {
          return;
        }
        const normalized = item.shapes;

        const current = next[photoKey] ?? [];
        const isSame = areShapesEqual(current, normalized);

        if (isSame) {
          return;
        }

        next[photoKey] = normalized;
        changed = true;
      });

      return changed ? next : previous;
    });
  }, [dirtyByPhoto, persistedAnnotations]);

  useEffect(() => {
    const persistedRoomReview = detail?.evidence.latestSubmission?.roomReviewSnapshot;
    if (!persistedRoomReview || persistedRoomReview.length === 0) {
      return;
    }

    setReviewByRoom(
      Object.fromEntries(
        persistedRoomReview.map((item) => [
          normalizeRoomKey(item.roomName),
          {
            verdict: item.verdict,
            note: item.note ?? "",
          },
        ]),
      ),
    );
  }, [detail?.evidence.latestSubmission?._id, detail?.evidence.latestSubmission?.roomReviewSnapshot]);

  useEffect(() => {
    if (!viewer) {
      return;
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setViewer(null);
        setDraftShape(null);
        setIsDrawingShape(false);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setViewer((previous) => {
          if (!previous) {
            return previous;
          }
          return {
            ...previous,
            index: previous.index === 0 ? previous.slides.length - 1 : previous.index - 1,
          };
        });
        setDraftShape(null);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setViewer((previous) => {
          if (!previous) {
            return previous;
          }
          return {
            ...previous,
            index: previous.index === previous.slides.length - 1 ? 0 : previous.index + 1,
          };
        });
        setDraftShape(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewer]);

  useEffect(() => {
    if (!compareRoomKey || viewer) {
      return;
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setCompareRoomKey(null);
        return;
      }
      const beforeMax = (compareRow?.before.length ?? 1) - 1;
      const afterMax = (compareRow?.after.length ?? 1) - 1;

      // Linked or before-side navigation: ArrowLeft / ArrowRight
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setCompareBeforeIndex((i) => Math.max(0, i - 1));
        if (compareLinked) {
          setCompareAfterIndex((i) => Math.max(0, i - 1));
        }
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setCompareBeforeIndex((i) => Math.min(beforeMax, i + 1));
        if (compareLinked) {
          setCompareAfterIndex((i) => Math.min(afterMax, i + 1));
        }
      }
      // After-side only navigation when unlinked: ; and '
      if (!compareLinked) {
        if (event.key === ";") {
          event.preventDefault();
          setCompareAfterIndex((i) => Math.max(0, i - 1));
        }
        if (event.key === "'") {
          event.preventDefault();
          setCompareAfterIndex((i) => Math.min(afterMax, i + 1));
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [compareRoomKey, compareLinked, compareRow, viewer]);

  if (detail === undefined) {
    return <div className="text-sm text-[var(--muted-foreground)]">Loading photo review...</div>;
  }

  if (!detail || !detail.job) {
    return <div className="text-sm text-[var(--muted-foreground)]">Job not found.</div>;
  }

  function markPhotoDirty(photoKey: string) {
    setDirtyByPhoto((previous) => ({
      ...previous,
      [photoKey]: true,
    }));
  }

  function openViewerForPhotos(photos: EvidencePhoto[], startPhotoId?: Id<"photos">) {
    const slides = buildViewerSlides(photos);
    if (!slides.length) {
      showToast("No valid image URL found for this selection.", "error");
      return;
    }

    const startKey = startPhotoId ? String(startPhotoId) : null;
    const startIndex = startKey
      ? Math.max(
          0,
          slides.findIndex((slide) => slide.photoKey === startKey),
        )
      : 0;

    setViewer({
      slides,
      index: startIndex,
    });
    setAnnotateEnabled(false);
    setDraftShape(null);
    setIsDrawingShape(false);
  }

  function closeViewer() {
    if (currentSlide && dirtyByPhoto[currentSlide.photoKey]) {
      const shouldClose = window.confirm(
        "You have unsaved annotation changes on this photo. Close anyway?",
      );
      if (!shouldClose) {
        return;
      }
    }
    setViewer(null);
    setDraftShape(null);
    setIsDrawingShape(false);
  }

  function moveViewer(delta: number) {
    setViewer((previous) => {
      if (!previous) {
        return previous;
      }
      const nextIndex =
        (previous.index + delta + previous.slides.length) % previous.slides.length;
      return {
        ...previous,
        index: nextIndex,
      };
    });
    setDraftShape(null);
    setIsDrawingShape(false);
  }

  function onSelectViewerSlide(index: number) {
    setViewer((previous) => {
      if (!previous) {
        return previous;
      }
      if (index < 0 || index > previous.slides.length - 1) {
        return previous;
      }
      return {
        ...previous,
        index,
      };
    });
    setDraftShape(null);
    setIsDrawingShape(false);
  }

  function getNormalizedPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.width === 0 ? 0 : (event.clientX - rect.left) / rect.width;
    const y = rect.height === 0 ? 0 : (event.clientY - rect.top) / rect.height;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };
  }

  function distanceBetweenPoints(left: AnnotationPoint, right: AnnotationPoint) {
    const dx = right.x - left.x;
    const dy = right.y - left.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function finalizeDraftShape(
    draft: DraftShape,
    color: string,
  ): ReviewShape | null {
    if (draft.kind === "freehand") {
      const simplified = draft.points.reduce<AnnotationPoint[]>((points, point, index) => {
        if (index === 0) {
          return [point];
        }
        const previous = points[points.length - 1];
        if (distanceBetweenPoints(previous, point) < 0.002) {
          return points;
        }
        points.push(point);
        return points;
      }, []);
      if (simplified.length < 2) {
        return null;
      }
      return {
        kind: "freehand",
        points: simplified,
        color,
      };
    }

    const length = distanceBetweenPoints(draft.from, draft.to);
    if (length < 0.01) {
      return null;
    }

    if (draft.kind === "circle") {
      const radius = Math.min(0.6, length);
      return {
        kind: "circle",
        x: draft.from.x,
        y: draft.from.y,
        r: radius,
        color,
      };
    }

    return {
      kind: draft.kind,
      from: draft.from,
      to: draft.to,
      color,
    };
  }

  function onViewerPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!annotateEnabled || !currentSlide) {
      return;
    }
    // Phase 3 of video-support: video slides do not accept drawing
    // input. Annotations on a moving frame are deferred — ADR-0006.
    if (currentSlide.mediaKind === "video") {
      return;
    }
    const point = getNormalizedPointer(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (annotationTool === "freehand") {
      setDraftShape({
        kind: "freehand",
        points: [point],
      });
    } else {
      setDraftShape({
        kind: annotationTool,
        from: point,
        to: point,
      });
    }
    setIsDrawingShape(true);
  }

  function onViewerPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!annotateEnabled || !isDrawingShape || !draftShape) {
      return;
    }

    const point = getNormalizedPointer(event);
    setDraftShape((previous) => {
      if (!previous) {
        return previous;
      }
      if (previous.kind === "freehand") {
        const last = previous.points[previous.points.length - 1];
        if (distanceBetweenPoints(last, point) < 0.003) {
          return previous;
        }
        return {
          ...previous,
          points: [...previous.points, point],
        };
      }
      return {
        ...previous,
        to: point,
      };
    });
  }

  function onViewerPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!annotateEnabled || !currentSlide || !draftShape) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const nextShape = finalizeDraftShape(draftShape, annotationColor);
    if (nextShape) {
      setAnnotationsByPhoto((previous) => ({
        ...previous,
        [currentSlide.photoKey]: [...(previous[currentSlide.photoKey] ?? []), nextShape],
      }));
      markPhotoDirty(currentSlide.photoKey);
    }

    setDraftShape(null);
    setIsDrawingShape(false);
  }

  function undoLastShape() {
    if (!currentSlide) {
      return;
    }
    setAnnotationsByPhoto((previous) => {
      const current = previous[currentSlide.photoKey] ?? [];
      if (!current.length) {
        return previous;
      }
      return {
        ...previous,
        [currentSlide.photoKey]: current.slice(0, -1),
      };
    });
    markPhotoDirty(currentSlide.photoKey);
  }

  function clearAllShapesForPhoto() {
    if (!currentSlide) {
      return;
    }
    setAnnotationsByPhoto((previous) => ({
      ...previous,
      [currentSlide.photoKey]: [],
    }));
    markPhotoDirty(currentSlide.photoKey);
    setDraftShape(null);
    setIsDrawingShape(false);
  }

  async function saveCurrentPhotoAnnotations() {
    if (!currentSlide || !dirtyByPhoto[currentSlide.photoKey]) {
      return;
    }

    setSavingPhotoKey(currentSlide.photoKey);
    try {
      await savePhotoReviewAnnotations({
        photoId: currentSlide.photoId,
        shapes: currentAnnotations.map((shape) => ({ ...shape })),
      });
      setDirtyByPhoto((previous) => ({
        ...previous,
        [currentSlide.photoKey]: false,
      }));
      showToast("Photo annotations saved.");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to save photo annotations."), "error");
    } finally {
      setSavingPhotoKey(null);
    }
  }

  async function onApproveJob() {
    if (!canDecision || !allReviewed || reworkCount > 0) {
      return;
    }

    setPendingDecision("approve");
    try {
      await approveCompletion({
        jobId,
        roomReviewSnapshot: buildRoomReviewSnapshot(roomRows, reviewByRoom),
      });
      showToast("Job approved from photo review.");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to approve job."), "error");
    } finally {
      setPendingDecision(null);
    }
  }

  async function onRejectJob() {
    if (!canDecision || !allReviewed) {
      return;
    }

    setPendingDecision("reject");
    try {
      const rejectionReason = buildRejectionReason({ rows: roomRows, reviewByRoom });
      await rejectCompletion({
        jobId,
        rejectionReason,
        roomReviewSnapshot: buildRoomReviewSnapshot(roomRows, reviewByRoom),
      });
      showToast("Job rejected to rework from photo review.");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to reject job."), "error");
    } finally {
      setPendingDecision(null);
    }
  }

  function setVerdict(roomKey: string, verdict: Exclude<ReviewVerdict, null>) {
    if (isReadOnlyReview) {
      return;
    }
    setReviewByRoom((previous) => ({
      ...previous,
      [roomKey]: {
        verdict,
        note: previous[roomKey]?.note ?? "",
      },
    }));
  }

  function setNote(roomKey: string, note: string) {
    if (isReadOnlyReview) {
      return;
    }
    setReviewByRoom((previous) => ({
      ...previous,
      [roomKey]: {
        verdict: previous[roomKey]?.verdict ?? null,
        note,
      },
    }));
  }

  function toggleNotes(roomKey: string) {
    setNotesOpenByRoom((previous) => ({
      ...previous,
      [roomKey]: !previous[roomKey],
    }));
  }

  function openCompare(roomKey: string) {
    setCompareRoomKey(roomKey);
    setCompareBeforeIndex(0);
    setCompareAfterIndex(0);
  }

  function compareNavigate(delta: number, side: "before" | "after") {
    if (compareLinked) {
      setCompareBeforeIndex((i) =>
        Math.max(0, Math.min(i + delta, (compareRow?.before.length ?? 1) - 1)),
      );
      setCompareAfterIndex((i) =>
        Math.max(0, Math.min(i + delta, (compareRow?.after.length ?? 1) - 1)),
      );
    } else if (side === "before") {
      setCompareBeforeIndex((i) =>
        Math.max(0, Math.min(i + delta, (compareRow?.before.length ?? 1) - 1)),
      );
    } else {
      setCompareAfterIndex((i) =>
        Math.max(0, Math.min(i + delta, (compareRow?.after.length ?? 1) - 1)),
      );
    }
  }

  function onRoomKeyDown(event: KeyboardEvent<HTMLDivElement>, row: RoomRow) {
    if (isReadOnlyReview) {
      return;
    }
    if (event.key === "1") {
      event.preventDefault();
      setVerdict(row.key, "pass");
      return;
    }
    if (event.key === "2") {
      event.preventDefault();
      setVerdict(row.key, "rework");
      return;
    }
    if (event.key.toLowerCase() === "o") {
      event.preventDefault();
      setCompareRoomKey(row.key);
    }
  }

  return (
    <div className="space-y-6 pb-28">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              Photo Review Workspace
            </p>
            <h1 className="mt-1 text-xl font-semibold">Room-by-Room QA</h1>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Click a photo to open the review viewer. Inside viewer: <kbd>←</kbd>/<kbd>→</kbd>
              to move slides, then enable markup mode for freehand, arrows, lines, and cloud marks.
            </p>
          </div>
          <Link
            href={`/jobs/${detail.job._id}`}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--accent)]"
          >
            Back to Job
          </Link>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <div className="rounded-md border border-[var(--border)] p-3 md:col-span-2">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Job</p>
            <p className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">{detail.job._id}</p>
            <p className="mt-2 text-sm font-medium">{detail.property?.name ?? "Unknown property"}</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {detail.cleaners[0]?.name ?? "Unassigned cleaner"}
            </p>
          </div>
          <div className="rounded-md border border-[var(--border)] p-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Status</p>
            <span
              className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs ${STATUS_CLASSNAMES[detail.job.status]}`}
            >
              {STATUS_LABELS[detail.job.status]}
            </span>
          </div>
          <div className="rounded-md border border-[var(--border)] p-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              Submission Revision
            </p>
            <p className="mt-1 text-lg font-semibold">{detail.evidence.latestSubmission?.revision ?? "—"}</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {formatDateTime(detail.evidence.latestSubmission?.submittedAtServer)}
            </p>
          </div>
          <div className="rounded-md border border-[var(--border)] p-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Review Progress</p>
            <p className="mt-1 text-lg font-semibold">
              {reviewedCount}/{Math.max(totalRooms, 1)} rooms
            </p>
            <div className="mt-2 h-2 rounded-full bg-[var(--muted)]">
              <div
                className="h-2 rounded-full bg-[var(--primary)] transition-all"
                style={{ width: `${reviewPercent}%` }}
              />
            </div>
          </div>
        </div>

        {fallbackInUse ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
            Showing sealed evidence from latest submission revision.
          </p>
        ) : null}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="space-y-3 md:hidden">
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className={`inline-flex items-center justify-center rounded-md border p-2 ${
                mobileControlPanel === "search"
                  ? "bg-[var(--accent)] text-[var(--foreground)]"
                  : "bg-[var(--background)] text-[var(--muted-foreground)]"
              }`}
              onClick={() =>
                setMobileControlPanel((current) =>
                  current === "search" ? null : "search",
                )
              }
              aria-label="Open room search"
            >
              <Search className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={`inline-flex items-center justify-center rounded-md border p-2 ${
                mobileControlPanel === "filter"
                  ? "bg-[var(--accent)] text-[var(--foreground)]"
                  : "bg-[var(--background)] text-[var(--muted-foreground)]"
              }`}
              onClick={() =>
                setMobileControlPanel((current) =>
                  current === "filter" ? null : "filter",
                )
              }
              aria-label="Open room filter"
            >
              <Filter className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={`inline-flex items-center justify-center rounded-md border p-2 ${
                mobileControlPanel === "sort"
                  ? "bg-[var(--accent)] text-[var(--foreground)]"
                  : "bg-[var(--background)] text-[var(--muted-foreground)]"
              }`}
              onClick={() =>
                setMobileControlPanel((current) =>
                  current === "sort" ? null : "sort",
                )
              }
              aria-label="Open sort mode"
            >
              <ArrowDownAZ className="h-4 w-4" />
            </button>
          </div>

          {mobileControlPanel === "search" ? (
            <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2">
              <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search room"
                autoFocus
                className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
              />
            </div>
          ) : null}

          {mobileControlPanel === "filter" ? (
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value as ReviewFilter);
                setMobileControlPanel(null);
              }}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="needs_review">Needs Review</option>
              <option value="missing">Missing</option>
              <option value="reviewed">Reviewed</option>
            </select>
          ) : null}

          {mobileControlPanel === "sort" ? (
            <select
              value={sortMode}
              onChange={(event) => {
                setSortMode(event.target.value as SortMode);
                setMobileControlPanel(null);
              }}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="checklist">Checklist Order</option>
              <option value="az">A-Z</option>
            </select>
          ) : null}
        </div>
        <div className="hidden gap-3 md:grid md:grid-cols-4">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search room"
            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm md:col-span-2"
          />
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as ReviewFilter)}
            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          >
            <option value="all">All</option>
            <option value="needs_review">Needs Review</option>
            <option value="missing">Missing</option>
            <option value="reviewed">Reviewed</option>
          </select>
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          >
            <option value="checklist">Checklist Order</option>
            <option value="az">A-Z</option>
          </select>
        </div>
      </div>

      <div className="hidden overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] md:block">
        <div className="grid grid-cols-[1.1fr_1fr_1fr] border-b border-[var(--border)] bg-[var(--background)] text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          <div className="sticky top-0 z-10 border-r border-[var(--border)] px-4 py-3">Room</div>
          <div className="sticky top-0 z-10 border-r border-[var(--border)] px-4 py-3">Before</div>
          <div className="sticky top-0 z-10 px-4 py-3">After</div>
        </div>

        {!visibleRows.length ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
            No rooms match this filter.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {visibleRows.map((row) => {
              const review = reviewByRoom[row.key] ?? { verdict: null, note: "" };
              const incidentsCount = row.incidents.length;
              const roomSlides = [...row.before, ...row.after, ...row.incidents];
              return (
                <div
                  key={row.key}
                  tabIndex={0}
                  onFocus={() => setActiveRoomKey(row.key)}
                  onKeyDown={(event) => onRoomKeyDown(event, row)}
                  className={`grid grid-cols-[1.1fr_1fr_1fr] outline-none transition-colors ${
                    activeRoomKey === row.key ? "bg-[var(--accent)]/40" : ""
                  }`}
                >
                  <div className="border-r border-[var(--border)] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{row.roomName}</h3>
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                        B {row.before.length} · A {row.after.length}
                      </span>
                      {incidentsCount > 0 ? (
                        <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
                          Incident {incidentsCount}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {row.hasMissingBefore ? <Pill tone="warning">Missing Before</Pill> : null}
                      {row.hasMissingAfter ? <Pill tone="warning">Missing After</Pill> : null}
                      {row.hasCountMismatch ? <Pill tone="warning">Count mismatch</Pill> : null}
                      {review.verdict === "pass" ? <Pill tone="success">Pass</Pill> : null}
                      {review.verdict === "rework" ? <Pill tone="danger">Needs Rework</Pill> : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setVerdict(row.key, "pass")}
                        disabled={isReadOnlyReview}
                        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                          review.verdict === "pass"
                            ? "border-emerald-600 bg-emerald-500 text-white"
                            : "border-[var(--border)] hover:border-emerald-500 hover:text-emerald-600"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <span>✓</span> Pass
                      </button>
                      <button
                        type="button"
                        onClick={() => setVerdict(row.key, "rework")}
                        disabled={isReadOnlyReview}
                        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                          review.verdict === "rework"
                            ? "border-rose-600 bg-rose-500 text-white"
                            : "border-[var(--border)] hover:border-rose-500 hover:text-rose-600"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <span>✗</span> Rework
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleNotes(row.key)}
                        className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs hover:bg-[var(--accent)]"
                      >
                        {notesOpenByRoom[row.key] ? "Hide Note" : "Add Note"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openCompare(row.key)}
                        className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs hover:bg-[var(--accent)]"
                      >
                        Compare
                      </button>
                    </div>

                    {notesOpenByRoom[row.key] ? (
                      <textarea
                        value={review.note}
                        onChange={(event) => setNote(row.key, event.target.value)}
                        disabled={isReadOnlyReview}
                        rows={2}
                        placeholder="Add room-specific feedback for this review..."
                        className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-70"
                      />
                    ) : null}
                  </div>

                  <div className="border-r border-[var(--border)] p-4">
                    <PhotoColumn
                      photos={row.before}
                      label="Before"
                      onOpenPhoto={(photo) => openViewerForPhotos(roomSlides, photo.photoId)}
                    />
                  </div>
                  <div className="p-4">
                    <PhotoColumn
                      photos={row.after}
                      label="After"
                      onOpenPhoto={(photo) => openViewerForPhotos(roomSlides, photo.photoId)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="md:hidden">
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted)]">
            <div
              className={`h-full rounded-full transition-all ${allReviewed ? "bg-[var(--success)]" : "bg-[var(--primary)]"}`}
              style={{ width: `${reviewPercent}%` }}
            />
          </div>
          <p className="shrink-0 text-xs font-semibold tabular-nums">
            {reviewedCount}/{totalRooms}
            {passCount > 0 ? <span className="ml-2 text-emerald-500">✓{passCount}</span> : null}
            {reworkCount > 0 ? <span className="ml-1 text-rose-500">✗{reworkCount}</span> : null}
          </p>
        </div>
        {!visibleRows.length ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
            No rooms match this filter.
          </div>
        ) : (
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
            {visibleRows.map((row, rowIdx) => {
              const review = reviewByRoom[row.key] ?? { verdict: null, note: "" };
              const roomSlides = [...row.before, ...row.after, ...row.incidents];
              return (
                <div
                  key={row.key}
                  className={`w-[94%] shrink-0 snap-start rounded-lg border bg-[var(--card)] p-3 ${
                    review.verdict === "pass"
                      ? "border-emerald-500/60"
                      : review.verdict === "rework"
                        ? "border-rose-500/60"
                        : "border-[var(--border)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] text-[var(--muted-foreground)]">
                        {rowIdx + 1} of {visibleRows.length}
                      </p>
                      <h3 className="truncate text-sm font-semibold">{row.roomName}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => openCompare(row.key)}
                      className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                    >
                      Compare
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.hasMissingBefore ? <Pill tone="warning">Missing Before</Pill> : null}
                    {row.hasMissingAfter ? <Pill tone="warning">Missing After</Pill> : null}
                    {row.hasCountMismatch ? <Pill tone="warning">Count mismatch</Pill> : null}
                  </div>

                  <div className="mt-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      Before
                    </p>
                    <PhotoColumn
                      photos={row.before}
                      label="Before"
                      onOpenPhoto={(photo) => openViewerForPhotos(roomSlides, photo.photoId)}
                    />
                  </div>
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      After
                    </p>
                    <PhotoColumn
                      photos={row.after}
                      label="After"
                      onOpenPhoto={(photo) => openViewerForPhotos(roomSlides, photo.photoId)}
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setVerdict(row.key, "pass")}
                      disabled={isReadOnlyReview}
                      className={`flex flex-col items-center justify-center gap-1 rounded-lg border py-3 font-semibold transition-colors ${
                        review.verdict === "pass"
                          ? "border-emerald-600 bg-emerald-500 text-white"
                          : "border-[var(--border)] text-[var(--muted-foreground)]"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <span className="text-xl leading-none">✓</span>
                      <span className="text-sm">Pass</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setVerdict(row.key, "rework")}
                      disabled={isReadOnlyReview}
                      className={`flex flex-col items-center justify-center gap-1 rounded-lg border py-3 font-semibold transition-colors ${
                        review.verdict === "rework"
                          ? "border-rose-600 bg-rose-500 text-white"
                          : "border-[var(--border)] text-[var(--muted-foreground)]"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <span className="text-xl leading-none">✗</span>
                      <span className="text-sm">Rework</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h3 className="text-sm font-semibold">Incident Evidence</h3>
        {incidentPhotos.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            No incident photos in this submission.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {incidentPhotos.map((photo, index) => (
              <ReviewPhotoTile
                key={`${photo.photoId}-${index}`}
                url={photo.url}
                label={photo.roomName}
                onOpen={() => openViewerForPhotos(incidentPhotos, photo.photoId)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--card)]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-2 w-28 shrink-0 overflow-hidden rounded-full bg-[var(--muted)]">
              <div
                className={`h-full rounded-full transition-all ${allReviewed ? "bg-[var(--success)]" : "bg-[var(--primary)]"}`}
                style={{ width: `${reviewPercent}%` }}
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {allReviewed ? (
                  <>
                    {reworkCount > 0 ? (
                      <span className="text-rose-500">{reworkCount} room{reworkCount !== 1 ? "s" : ""} need rework</span>
                    ) : (
                      <span className="text-[var(--success)]">All {totalRooms} rooms passed ✓</span>
                    )}
                  </>
                ) : (
                  <>{totalRooms - reviewedCount} room{totalRooms - reviewedCount !== 1 ? "s" : ""} still need review</>
                )}
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {passCount > 0 ? <span className="text-emerald-600">{passCount} pass</span> : null}
                {passCount > 0 && reworkCount > 0 ? <span> · </span> : null}
                {reworkCount > 0 ? <span className="text-rose-500">{reworkCount} rework</span> : null}
                {!canDecision && (
                  <span className="ml-1">
                    · Decision requires{" "}
                    <span className="font-medium">Awaiting Approval</span> status
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRejectJob}
              disabled={!canDecision || !allReviewed || pendingDecision !== null}
              className="rounded-md border border-[var(--destructive)] px-3 py-1.5 text-sm text-[var(--destructive)] disabled:opacity-50"
            >
              {pendingDecision === "reject" ? "Rejecting..." : "Reject"}
            </button>
            <button
              type="button"
              onClick={onApproveJob}
              disabled={
                !canDecision ||
                !allReviewed ||
                reworkCount > 0 ||
                pendingDecision !== null
              }
              className="rounded-md bg-[var(--success)] px-3 py-1.5 text-sm font-medium text-[var(--success-foreground)] disabled:opacity-50"
            >
              {pendingDecision === "approve" ? "Approving..." : "Approve Job"}
            </button>
          </div>
        </div>
      </div>

      {compareRow ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-black/90 p-2">
          {/* ── Top bar ─────────────────────────────────────────── */}
          <div className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
            {/* Row 1: room name + close */}
            <div className="flex items-center justify-between gap-2">
              <h2 className="truncate text-sm font-semibold">{compareRow.roomName} · Compare</h2>
              <button
                type="button"
                onClick={() => setCompareRoomKey(null)}
                className="shrink-0 rounded-md border border-[var(--border)] px-2.5 py-1 text-xs"
              >
                ✕ Close
              </button>
            </div>
            {/* Row 2: verdict + linked buttons */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCompareLinked((v) => !v)}
                title={
                  compareLinked
                    ? "Sides linked — arrows move both together. Click to unlink."
                    : "Sides unlinked — arrows move each side independently. Click to link."
                }
                className={`rounded-md border px-2.5 py-1 text-[11px] ${
                  compareLinked
                    ? "border-blue-700 bg-blue-600 text-white"
                    : "border-[var(--border)]"
                }`}
              >
                {compareLinked ? "Linked ⇔" : "Unlinked ⇔"}
              </button>
              {(() => {
                const review = reviewByRoom[compareRow.key] ?? { verdict: null, note: "" };
                return (
                  <>
                    <button
                      type="button"
                      onClick={() => setVerdict(compareRow.key, "pass")}
                      disabled={isReadOnlyReview}
                      className={`rounded-md border px-2.5 py-1 text-[11px] ${
                        review.verdict === "pass"
                          ? "border-emerald-600 bg-emerald-100 text-emerald-700"
                          : "border-[var(--border)]"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      Pass
                    </button>
                    <button
                      type="button"
                      onClick={() => setVerdict(compareRow.key, "rework")}
                      disabled={isReadOnlyReview}
                      className={`rounded-md border px-2.5 py-1 text-[11px] ${
                        review.verdict === "rework"
                          ? "border-rose-600 bg-rose-100 text-rose-700"
                          : "border-[var(--border)]"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      Rework
                    </button>
                  </>
                );
              })()}
            </div>
          </div>

          {/* ── Two-column split (stacked on mobile, side-by-side on md+) */}
          <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-2 md:grid-cols-2 md:grid-rows-1">
            {/* BEFORE column */}
            <div className="flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
              <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Before
                </span>
                <span className="ml-auto font-mono text-xs text-[var(--muted-foreground)]">
                  {compareRow.before.length === 0
                    ? "0 photos"
                    : `${compareBeforeIndex + 1} / ${compareRow.before.length}`}
                </span>
              </div>

              {/* Main photo */}
              <div className="relative min-h-0 flex-1 bg-black">
                {compareBeforePhoto?.url ? (
                  <>
                    <Image
                      src={compareBeforePhoto.url}
                      alt={`${compareRow.roomName} before`}
                      fill
                      className="object-contain"
                    />
                    {compareBeforeIndex > 0 ? (
                      <button
                        type="button"
                        onClick={() => compareNavigate(-1, "before")}
                        aria-label="Previous before photo"
                        className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-sm text-white hover:bg-black/80"
                      >
                        ◀
                      </button>
                    ) : null}
                    {compareBeforeIndex < compareRow.before.length - 1 ? (
                      <button
                        type="button"
                        onClick={() => compareNavigate(1, "before")}
                        aria-label="Next before photo"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-sm text-white hover:bg-black/80"
                      >
                        ▶
                      </button>
                    ) : null}
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">
                    No photo
                  </div>
                )}
              </div>

              {/* Timestamp */}
              <p className="min-h-[1.5rem] px-3 py-1 font-mono text-[10px] text-[var(--muted-foreground)]">
                {compareBeforePhoto?.uploadedAt
                  ? formatPhotoTimestamp(compareBeforePhoto.uploadedAt)
                  : null}
              </p>

              {/* Filmstrip */}
              {compareRow.before.length > 1 ? (
                <div className="flex gap-1.5 overflow-x-auto border-t border-[var(--border)] px-3 py-2">
                  {compareRow.before.map((photo, idx) => (
                    <button
                      key={`before-${photo.photoId}-${idx}`}
                      type="button"
                      onClick={() => setCompareBeforeIndex(idx)}
                      aria-label={`Before photo ${idx + 1}`}
                      className={`relative h-11 w-16 shrink-0 overflow-hidden rounded border-2 transition-colors ${
                        idx === compareBeforeIndex
                          ? "border-blue-500"
                          : "border-transparent opacity-60 hover:opacity-100"
                      }`}
                    >
                      {photo.url ? (
                        <Image src={photo.url} alt={`Before ${idx + 1}`} fill className="object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-[var(--muted)] text-[8px] text-[var(--muted-foreground)]">
                          —
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* AFTER column */}
            <div className="flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
              <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  After
                </span>
                <span className="ml-auto font-mono text-xs text-[var(--muted-foreground)]">
                  {compareRow.after.length === 0
                    ? "0 photos"
                    : `${compareAfterIndex + 1} / ${compareRow.after.length}`}
                </span>
              </div>

              {/* Main photo */}
              <div className="relative min-h-0 flex-1 bg-black">
                {compareAfterPhoto?.url ? (
                  <>
                    <Image
                      src={compareAfterPhoto.url}
                      alt={`${compareRow.roomName} after`}
                      fill
                      className="object-contain"
                    />
                    {compareAfterIndex > 0 ? (
                      <button
                        type="button"
                        onClick={() => compareNavigate(-1, "after")}
                        aria-label="Previous after photo"
                        className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-sm text-white hover:bg-black/80"
                      >
                        ◀
                      </button>
                    ) : null}
                    {compareAfterIndex < compareRow.after.length - 1 ? (
                      <button
                        type="button"
                        onClick={() => compareNavigate(1, "after")}
                        aria-label="Next after photo"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-sm text-white hover:bg-black/80"
                      >
                        ▶
                      </button>
                    ) : null}
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">
                    No photo
                  </div>
                )}
              </div>

              {/* Timestamp */}
              <p className="min-h-[1.5rem] px-3 py-1 font-mono text-[10px] text-[var(--muted-foreground)]">
                {compareAfterPhoto?.uploadedAt
                  ? formatPhotoTimestamp(compareAfterPhoto.uploadedAt)
                  : null}
              </p>

              {/* Filmstrip */}
              {compareRow.after.length > 1 ? (
                <div className="flex gap-1.5 overflow-x-auto border-t border-[var(--border)] px-3 py-2">
                  {compareRow.after.map((photo, idx) => (
                    <button
                      key={`after-${photo.photoId}-${idx}`}
                      type="button"
                      onClick={() => setCompareAfterIndex(idx)}
                      aria-label={`After photo ${idx + 1}`}
                      className={`relative h-11 w-16 shrink-0 overflow-hidden rounded border-2 transition-colors ${
                        idx === compareAfterIndex
                          ? "border-blue-500"
                          : "border-transparent opacity-60 hover:opacity-100"
                      }`}
                    >
                      {photo.url ? (
                        <Image src={photo.url} alt={`After ${idx + 1}`} fill className="object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-[var(--muted)] text-[8px] text-[var(--muted-foreground)]">
                          —
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {/* ── Prev / Next Room bar ─────────────────────────────── */}
          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
            <button
              type="button"
              disabled={!prevCompareRoom}
              onClick={() => prevCompareRoom && openCompare(prevCompareRoom.key)}
              className="flex max-w-[38%] items-center gap-1 truncate rounded-md border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-40"
            >
              <span>◀</span>
              <span className="truncate">{prevCompareRoom ? prevCompareRoom.roomName : "Prev"}</span>
            </button>
            <span className="shrink-0 font-mono text-xs text-[var(--muted-foreground)]">
              {compareRoomIdx + 1} / {visibleRows.length}
            </span>
            <button
              type="button"
              disabled={!nextCompareRoom}
              onClick={() => nextCompareRoom && openCompare(nextCompareRoom.key)}
              className="flex max-w-[38%] items-center gap-1 truncate rounded-md border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-40"
            >
              <span className="truncate">{nextCompareRoom ? nextCompareRoom.roomName : "Next"}</span>
              <span>▶</span>
            </button>
          </div>
        </div>
      ) : null}

      {viewer && currentSlide ? (
        <div className="fixed inset-0 z-50 bg-black/80 p-3">
          <div className="mx-auto flex h-full w-full max-w-7xl flex-col rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold">
                  {currentSlide.roomName} · {currentSlide.type} · {viewer.index + 1}/{viewer.slides.length}
                </h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {currentSlide.uploadedAt ? (
                    <span className="mr-2 font-mono">{formatPhotoTimestamp(currentSlide.uploadedAt)}</span>
                  ) : null}
                  Mark corrections with freehand, arrows, lines, or cloud callouts directly on the photo.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={saveCurrentPhotoAnnotations}
                  disabled={!isCurrentPhotoDirty || savingPhotoKey === currentSlide.photoKey}
                  className="rounded-md border border-blue-700 bg-blue-600 px-2.5 py-1 text-xs text-white disabled:opacity-50"
                >
                  {savingPhotoKey === currentSlide.photoKey ? "Saving..." : "Save Annotations"}
                </button>
                <button
                  type="button"
                  onClick={() => setAnnotateEnabled((previous) => !previous)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    annotateEnabled
                      ? "border-blue-700 bg-blue-600 text-white"
                      : "border-[var(--border)]"
                  }`}
                >
                  {annotateEnabled ? "Markup: ON" : "Markup: OFF"}
                </button>
                <button
                  type="button"
                  onClick={undoLastShape}
                  className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs"
                >
                  Undo
                </button>
                <button
                  type="button"
                  onClick={clearAllShapesForPhoto}
                  className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs"
                >
                  Clear Markup
                </button>
                <a
                  href={currentSlide.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--accent)]"
                >
                  Open Original
                </a>
                <button
                  type="button"
                  onClick={closeViewer}
                  className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--muted-foreground)]">Tool:</span>
              {[
                { key: "freehand", label: "Freehand" },
                { key: "arrow", label: "Arrow" },
                { key: "line", label: "Line" },
                { key: "cloud", label: "Cloud" },
                { key: "circle", label: "Circle" },
              ].map((tool) => (
                <button
                  key={tool.key}
                  type="button"
                  onClick={() => setAnnotationTool(tool.key as AnnotationTool)}
                  className={`rounded-md border px-2 py-1 text-[11px] ${
                    annotationTool === tool.key
                      ? "border-blue-700 bg-blue-600 text-white"
                      : "border-[var(--border)]"
                  }`}
                >
                  {tool.label}
                </button>
              ))}
              <span className="ml-2 text-xs text-[var(--muted-foreground)]">Color:</span>
              {["#ef4444", "#f59e0b", "#22c55e", "#3b82f6"].map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setAnnotationColor(color)}
                  className={`h-5 w-5 rounded-full border ${
                    annotationColor === color ? "border-2 border-white ring-2 ring-blue-500" : "border-white/50"
                  }`}
                  style={{ backgroundColor: color }}
                  aria-label={`Select annotation color ${color}`}
                />
              ))}
              <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                Markups on this photo: {currentAnnotations.length}
              </span>
              {isCurrentPhotoDirty ? (
                <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">
                  Unsaved changes
                </span>
              ) : (
                <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">
                  Saved
                </span>
              )}
            </div>

            <div className="flex min-h-0 flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => moveViewer(-1)}
                className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
              >
                Prev
              </button>

              <div className="relative min-h-0 flex-1">
                <div
                  ref={viewerCanvasRef}
                  onPointerDown={onViewerPointerDown}
                  onPointerMove={onViewerPointerMove}
                  onPointerUp={onViewerPointerUp}
                  onPointerCancel={onViewerPointerUp}
                  className={`relative h-[64vh] rounded-md border border-[var(--border)] bg-black/40 ${
                    annotateEnabled && currentSlide.mediaKind !== "video"
                      ? "cursor-crosshair"
                      : "cursor-default"
                  }`}
                >
                  {currentSlide.mediaKind === "video" ? (
                    /* Phase 3 of video-support: render the player instead
                       of an Image. Annotations are intentionally hidden —
                       per ADR-0006 video annotation is deferred. */
                    <VideoPlayer
                      src={currentSlide.url}
                      poster={currentSlide.posterUrl ?? null}
                      durationMs={currentSlide.durationMs}
                      ariaLabel={`${currentSlide.roomName} ${currentSlide.type}`}
                      className="absolute inset-0 h-full w-full object-contain"
                    />
                  ) : (
                    <>
                      <Image
                        src={currentSlide.url}
                        alt={`${currentSlide.roomName} ${currentSlide.type}`}
                        fill
                        sizes="100vw"
                        className="pointer-events-none select-none object-contain"
                      />

                      <svg
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        className="pointer-events-none absolute inset-0 h-full w-full"
                      >
                        {currentAnnotations.map((shape, index) => (
                          <g key={`${currentSlide.photoKey}-${index}`}>
                            {renderAnnotationShape(shape, false)}
                          </g>
                        ))}
                        {draftShape
                          ? renderDraftShape(draftShape, annotationColor)
                          : null}
                      </svg>
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => moveViewer(1)}
                className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
              >
                Next
              </button>
            </div>

            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {viewer.slides.map((slide, index) => (
                <button
                  key={slide.key}
                  type="button"
                  onClick={() => onSelectViewerSlide(index)}
                  className={`overflow-hidden rounded-md border ${
                    index === viewer.index
                      ? "border-blue-500 ring-2 ring-blue-500"
                      : "border-[var(--border)]"
                  }`}
                >
                  <Image
                    src={slide.url}
                    alt={`${slide.roomName} ${slide.type}`}
                    width={120}
                    height={72}
                    className="h-16 w-24 object-cover"
                  />
                  <p className="px-1 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                    {slide.type}
                  </p>
                  {dirtyByPhoto[slide.photoKey] ? (
                    <p className="border-t border-amber-200 bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-800">
                      unsaved
                    </p>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function toViewBox(value: number): number {
  return Number((clampUnit(value) * 100).toFixed(4));
}

function pointDistance(left: AnnotationPoint, right: AnnotationPoint): number {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getArrowHeadPoints(from: AnnotationPoint, to: AnnotationPoint): AnnotationPoint[] {
  const length = pointDistance(from, to);
  if (length < 0.001) {
    return [];
  }
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const headLength = Math.max(0.02, Math.min(0.05, length * 0.32));
  const halfWidth = headLength * 0.45;
  const baseX = to.x - ux * headLength;
  const baseY = to.y - uy * headLength;
  const perpX = -uy;
  const perpY = ux;
  return [
    to,
    {
      x: clampUnit(baseX + perpX * halfWidth),
      y: clampUnit(baseY + perpY * halfWidth),
    },
    {
      x: clampUnit(baseX - perpX * halfWidth),
      y: clampUnit(baseY - perpY * halfWidth),
    },
  ];
}

function getCloudBubbles(from: AnnotationPoint, to: AnnotationPoint) {
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2;
  const rx = Math.abs(to.x - from.x) / 2;
  const ry = Math.abs(to.y - from.y) / 2;
  if (rx < 0.006 || ry < 0.006) {
    return [];
  }

  const perimeter = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2);
  const bubbleBase = Math.max(0.008, Math.min(0.03, Math.min(rx, ry) * 0.28));
  const segmentCount = Math.max(10, Math.min(28, Math.round(perimeter / (bubbleBase * 1.5))));
  const bubbles: Array<{ x: number; y: number; r: number }> = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const theta = (index / segmentCount) * Math.PI * 2;
    const wobble = 1 + 0.08 * Math.sin(theta * 7);
    const baseX = cx + rx * Math.cos(theta);
    const baseY = cy + ry * Math.sin(theta);
    const outward = bubbleBase * 0.3;
    bubbles.push({
      x: clampUnit(baseX + Math.cos(theta) * outward),
      y: clampUnit(baseY + Math.sin(theta) * outward),
      r: bubbleBase * wobble,
    });
  }
  return bubbles;
}

function renderAnnotationShape(shape: ReviewShape, draft: boolean): ReactNode {
  const strokeWidth = draft ? 0.55 : 0.9;
  const strokeDasharray = draft ? "2 1.5" : undefined;

  if (shape.kind === "circle") {
    return (
      <circle
        cx={toViewBox(shape.x)}
        cy={toViewBox(shape.y)}
        r={toViewBox(shape.r)}
        fill="none"
        stroke={shape.color}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
      />
    );
  }

  if (shape.kind === "freehand") {
    const points = shape.points.map((point) => `${toViewBox(point.x)},${toViewBox(point.y)}`).join(" ");
    return (
      <polyline
        points={points}
        fill="none"
        stroke={shape.color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={strokeDasharray}
      />
    );
  }

  if (shape.kind === "line") {
    return (
      <line
        x1={toViewBox(shape.from.x)}
        y1={toViewBox(shape.from.y)}
        x2={toViewBox(shape.to.x)}
        y2={toViewBox(shape.to.y)}
        stroke={shape.color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={strokeDasharray}
      />
    );
  }

  if (shape.kind === "arrow") {
    const arrowHead = getArrowHeadPoints(shape.from, shape.to);
    const arrowHeadPoints = arrowHead
      .map((point) => `${toViewBox(point.x)},${toViewBox(point.y)}`)
      .join(" ");

    return (
      <>
        <line
          x1={toViewBox(shape.from.x)}
          y1={toViewBox(shape.from.y)}
          x2={toViewBox(shape.to.x)}
          y2={toViewBox(shape.to.y)}
          stroke={shape.color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={strokeDasharray}
        />
        {arrowHeadPoints ? (
          <polygon
            points={arrowHeadPoints}
            fill={shape.color}
            opacity={draft ? 0.8 : 1}
          />
        ) : null}
      </>
    );
  }

  const bubbles = getCloudBubbles(shape.from, shape.to);
  return (
    <>
      {bubbles.map((bubble, index) => (
        <circle
          key={`${shape.kind}-${index}`}
          cx={toViewBox(bubble.x)}
          cy={toViewBox(bubble.y)}
          r={toViewBox(bubble.r)}
          fill="none"
          stroke={shape.color}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
        />
      ))}
    </>
  );
}

function renderDraftShape(draftShape: DraftShape, color: string): ReactNode {
  if (draftShape.kind === "freehand") {
    if (draftShape.points.length < 2) {
      return null;
    }
    return renderAnnotationShape(
      {
        kind: "freehand",
        points: draftShape.points,
        color,
      },
      true,
    );
  }

  if (draftShape.kind === "circle") {
    const radius = Math.min(0.6, pointDistance(draftShape.from, draftShape.to));
    if (radius < 0.005) {
      return null;
    }
    return renderAnnotationShape(
      {
        kind: "circle",
        x: draftShape.from.x,
        y: draftShape.from.y,
        r: radius,
        color,
      },
      true,
    );
  }

  return renderAnnotationShape(
    {
      kind: draftShape.kind,
      from: draftShape.from,
      to: draftShape.to,
      color,
    },
    true,
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "warning" | "success" | "danger";
  children: ReactNode;
}) {
  const styles: Record<string, string> = {
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    danger: "border-rose-200 bg-rose-50 text-rose-700",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${styles[tone]}`}>
      {children}
    </span>
  );
}

function PhotoColumn({
  photos,
  label,
  onOpenPhoto,
}: {
  photos: EvidencePhoto[];
  label: string;
  onOpenPhoto?: (photo: EvidencePhoto) => void;
}) {
  if (!photos.length) {
    return (
      <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-[var(--border)] text-xs text-[var(--muted-foreground)]">
        No {label.toLowerCase()} photos
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {photos.map((photo, index) => (
        <ReviewPhotoTile
          key={`${photo.photoId}-${index}`}
          url={photo.url}
          posterUrl={photo.posterUrl}
          mediaKind={photo.mediaKind}
          durationMs={photo.durationMs}
          label={photo.roomName}
          uploadedAt={photo.uploadedAt}
          onOpen={() => onOpenPhoto?.(photo)}
        />
      ))}
    </div>
  );
}

function ReviewPhotoTile({
  url,
  posterUrl,
  mediaKind,
  durationMs,
  label,
  uploadedAt,
  onOpen,
}: {
  url: string | null;
  posterUrl?: string | null;
  mediaKind?: "image" | "video";
  durationMs?: number;
  label: string;
  uploadedAt?: number | null;
  onOpen?: () => void;
}) {
  if (!url) {
    return (
      <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-[var(--border)] text-[10px] text-[var(--muted-foreground)]">
        Missing file URL
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group overflow-hidden rounded-md border border-[var(--border)] text-left"
    >
      <MediaThumbnail
        url={url}
        posterUrl={posterUrl ?? null}
        mediaKind={mediaKind ?? "image"}
        durationMs={durationMs}
        alt={label}
        sizes="(max-width: 768px) 50vw, 320px"
        className="relative block h-24 w-full overflow-hidden transition-transform group-hover:scale-105"
      />
      {uploadedAt ? (
        <span className="block bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-white/90">
          {formatPhotoTimestamp(uploadedAt)}
        </span>
      ) : null}
      <p className="truncate border-t border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted-foreground)]">
        {cleanRoomName(label)}
      </p>
    </button>
  );
}
