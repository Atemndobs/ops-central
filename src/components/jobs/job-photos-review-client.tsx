"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";
import { STATUS_CLASSNAMES, STATUS_LABELS } from "@/components/jobs/job-status";

type ReviewVerdict = "pass" | "rework" | null;
type ReviewFilter = "all" | "needs_review" | "missing" | "reviewed";
type RoomReviewState = {
  verdict: ReviewVerdict;
  note: string;
};
type SortMode = "checklist" | "az";

function formatDateTime(value?: number | null) {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
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

type EvidencePhoto = {
  photoId: Id<"photos">;
  roomName: string;
  type: "before" | "after" | "incident";
  url: string | null;
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

export function JobPhotosReviewClient({ id }: { id: string }) {
  const jobId = id as Id<"cleaningJobs">;
  const { showToast } = useToast();

  const detail = useQuery(api.cleaningJobs.queries.getJobDetail, { jobId });
  const approveCompletion = useMutation(api.cleaningJobs.approve.approveCompletion);
  const rejectCompletion = useMutation(api.cleaningJobs.approve.rejectCompletion);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("checklist");
  const [reviewByRoom, setReviewByRoom] = useState<Record<string, RoomReviewState>>({});
  const [notesOpenByRoom, setNotesOpenByRoom] = useState<Record<string, boolean>>({});
  const [compareRoomKey, setCompareRoomKey] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<"approve" | "reject" | null>(null);
  const [activeRoomKey, setActiveRoomKey] = useState<string | null>(null);

  const currentPhotosAll = detail?.evidence.current.byType.all ?? [];
  const latestSubmissionPhotos = detail?.evidence.latestSubmission?.photos ?? [];
  const evidencePhotos = currentPhotosAll.length
    ? (currentPhotosAll as EvidencePhoto[])
    : (latestSubmissionPhotos as EvidencePhoto[]);
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

  const totalRooms = roomRows.length;
  const reviewedCount = roomRows.filter((row) => reviewByRoom[row.key]?.verdict !== null).length;
  const passCount = roomRows.filter((row) => reviewByRoom[row.key]?.verdict === "pass").length;
  const reworkCount = roomRows.filter((row) => reviewByRoom[row.key]?.verdict === "rework").length;
  const reviewPercent = totalRooms === 0 ? 0 : Math.round((reviewedCount / totalRooms) * 100);
  const allReviewed = totalRooms > 0 && reviewedCount === totalRooms;
  const canDecision = detail?.job.status === "awaiting_approval";

  if (detail === undefined) {
    return <div className="text-sm text-[var(--muted-foreground)]">Loading photo review...</div>;
  }

  if (!detail || !detail.job) {
    return <div className="text-sm text-[var(--muted-foreground)]">Job not found.</div>;
  }

  async function onApproveJob() {
    if (!canDecision || !allReviewed || reworkCount > 0) {
      return;
    }

    setPendingDecision("approve");
    try {
      await approveCompletion({ jobId });
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
      await rejectCompletion({ jobId, rejectionReason });
      showToast("Job rejected to rework from photo review.");
    } catch (error) {
      showToast(getErrorMessage(error, "Unable to reject job."), "error");
    } finally {
      setPendingDecision(null);
    }
  }

  function setVerdict(roomKey: string, verdict: Exclude<ReviewVerdict, null>) {
    setReviewByRoom((previous) => ({
      ...previous,
      [roomKey]: {
        verdict,
        note: previous[roomKey]?.note ?? "",
      },
    }));
  }

  function setNote(roomKey: string, note: string) {
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

  function onRoomKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    row: RoomRow,
  ) {
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
              Review each room row with keyboard shortcuts: <kbd>1</kbd> Pass, <kbd>2</kbd>{" "}
              Needs Rework, <kbd>O</kbd> Open Compare.
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
        <div className="grid gap-3 md:grid-cols-4">
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
                      {row.hasMissingBefore ? (
                        <Pill tone="warning">Missing Before</Pill>
                      ) : null}
                      {row.hasMissingAfter ? (
                        <Pill tone="warning">Missing After</Pill>
                      ) : null}
                      {row.hasCountMismatch ? (
                        <Pill tone="warning">Count mismatch</Pill>
                      ) : null}
                      {review.verdict === "pass" ? <Pill tone="success">Pass</Pill> : null}
                      {review.verdict === "rework" ? <Pill tone="danger">Needs Rework</Pill> : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setVerdict(row.key, "pass")}
                        className={`rounded-md border px-2.5 py-1 text-xs ${
                          review.verdict === "pass"
                            ? "border-emerald-600 bg-emerald-100 text-emerald-700"
                            : "border-[var(--border)]"
                        }`}
                      >
                        Pass
                      </button>
                      <button
                        type="button"
                        onClick={() => setVerdict(row.key, "rework")}
                        className={`rounded-md border px-2.5 py-1 text-xs ${
                          review.verdict === "rework"
                            ? "border-rose-600 bg-rose-100 text-rose-700"
                            : "border-[var(--border)]"
                        }`}
                      >
                        Needs Rework
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleNotes(row.key)}
                        className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs"
                      >
                        Add Note
                      </button>
                      <button
                        type="button"
                        onClick={() => setCompareRoomKey(row.key)}
                        className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs"
                      >
                        Open Compare
                      </button>
                    </div>

                    {notesOpenByRoom[row.key] ? (
                      <textarea
                        value={review.note}
                        onChange={(event) => setNote(row.key, event.target.value)}
                        rows={2}
                        placeholder="Add room-specific feedback for this review..."
                        className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                      />
                    ) : null}
                  </div>

                  <div className="border-r border-[var(--border)] p-4">
                    <PhotoColumn photos={row.before} label="Before" />
                  </div>
                  <div className="p-4">
                    <PhotoColumn photos={row.after} label="After" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="md:hidden">
        {!visibleRows.length ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
            No rooms match this filter.
          </div>
        ) : (
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
            {visibleRows.map((row) => {
              const review = reviewByRoom[row.key] ?? { verdict: null, note: "" };
              return (
                <div
                  key={row.key}
                  className="w-[94%] shrink-0 snap-start rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{row.roomName}</h3>
                    <button
                      type="button"
                      onClick={() => setCompareRoomKey(row.key)}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                    >
                      Compare
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.hasMissingBefore ? <Pill tone="warning">Missing Before</Pill> : null}
                    {row.hasMissingAfter ? <Pill tone="warning">Missing After</Pill> : null}
                    {row.hasCountMismatch ? <Pill tone="warning">Count mismatch</Pill> : null}
                    {review.verdict === "pass" ? <Pill tone="success">Pass</Pill> : null}
                    {review.verdict === "rework" ? <Pill tone="danger">Needs Rework</Pill> : null}
                  </div>

                  <div className="mt-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      Before
                    </p>
                    <PhotoColumn photos={row.before} label="Before" />
                  </div>
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      After
                    </p>
                    <PhotoColumn photos={row.after} label="After" />
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setVerdict(row.key, "pass")}
                      className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${
                        review.verdict === "pass"
                          ? "border-emerald-600 bg-emerald-100 text-emerald-700"
                          : "border-[var(--border)]"
                      }`}
                    >
                      Pass
                    </button>
                    <button
                      type="button"
                      onClick={() => setVerdict(row.key, "rework")}
                      className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${
                        review.verdict === "rework"
                          ? "border-rose-600 bg-rose-100 text-rose-700"
                          : "border-[var(--border)]"
                      }`}
                    >
                      Needs Rework
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
        {evidencePhotos.filter((photo) => photo.type === "incident").length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            No incident photos in this submission.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {evidencePhotos
              .filter((photo) => photo.type === "incident")
              .map((photo, index) => (
                <ReviewPhotoTile
                  key={`${photo.photoId}-${index}`}
                  url={photo.url}
                  label={photo.roomName}
                />
              ))}
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--card)]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">
              Reviewed {reviewedCount}/{Math.max(totalRooms, 1)} · Pass {passCount} · Rework{" "}
              {reworkCount}
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {canDecision
                ? "Finalize once all rooms are reviewed."
                : `Current job status is ${STATUS_LABELS[detail.job.status]}. Decision actions are available only in Awaiting Approval.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRejectJob}
              disabled={!canDecision || !allReviewed || pendingDecision !== null}
              className="rounded-md border border-[var(--destructive)] px-3 py-1.5 text-sm text-[var(--destructive)] disabled:opacity-50"
            >
              {pendingDecision === "reject" ? "Rejecting..." : "Reject to Rework"}
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{compareRow.roomName} · Compare</h2>
              <button
                type="button"
                onClick={() => setCompareRoomKey(null)}
                className="rounded-md border border-[var(--border)] px-3 py-1 text-sm"
              >
                Close
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Before ({compareRow.before.length})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {compareRow.before.map((photo, index) => (
                    <ComparePhotoTile
                      key={`${photo.photoId}-${index}`}
                      url={photo.url}
                      label={compareRow.roomName}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  After ({compareRow.after.length})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {compareRow.after.map((photo, index) => (
                    <ComparePhotoTile
                      key={`${photo.photoId}-${index}`}
                      url={photo.url}
                      label={compareRow.roomName}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
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

function PhotoColumn({ photos, label }: { photos: EvidencePhoto[]; label: string }) {
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
        <ReviewPhotoTile key={`${photo.photoId}-${index}`} url={photo.url} label={photo.roomName} />
      ))}
    </div>
  );
}

function ReviewPhotoTile({ url, label }: { url: string | null; label: string }) {
  if (!url) {
    return (
      <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-[var(--border)] text-[10px] text-[var(--muted-foreground)]">
        Missing file URL
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group overflow-hidden rounded-md border border-[var(--border)]"
    >
      <Image
        src={url}
        alt={label}
        width={320}
        height={160}
        className="h-24 w-full object-cover transition-transform group-hover:scale-105"
      />
      <p className="truncate border-t border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted-foreground)]">
        {cleanRoomName(label)}
      </p>
    </a>
  );
}

function ComparePhotoTile({ url, label }: { url: string | null; label: string }) {
  if (!url) {
    return (
      <div className="flex h-36 items-center justify-center rounded-md border border-dashed border-[var(--border)] text-sm text-[var(--muted-foreground)]">
        Missing file URL
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group overflow-hidden rounded-md border border-[var(--border)]"
    >
      <Image
        src={url}
        alt={label}
        width={600}
        height={340}
        className="h-40 w-full object-cover transition-transform group-hover:scale-105"
      />
    </a>
  );
}
