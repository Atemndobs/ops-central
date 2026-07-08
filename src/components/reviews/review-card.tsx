"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Star, Loader2, Send, X, RotateCcw } from "lucide-react";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";

export type ReviewRow = {
  _id: Id<"guestReviews">;
  propertyId: Id<"properties">;
  propertyName?: string;
  platform: "airbnb" | "direct";
  rating: number;
  publicReview: string;
  guestFirstName: string;
  guestLastName: string;
  reviewedAt: number;
  status: "needs_draft" | "drafted" | "sending" | "sent" | "dismissed" | "send_failed";
  aiDraftText?: string;
  respondedText?: string;
  sendError?: string;
};

const STATUS_LABEL: Record<ReviewRow["status"], string> = {
  needs_draft: "Drafting…",
  drafted: "Needs approval",
  sending: "Sending…",
  sent: "Sent",
  dismissed: "Dismissed",
  send_failed: "Send failed",
};

const STATUS_CLASS: Record<ReviewRow["status"], string> = {
  needs_draft: "bg-slate-100 text-slate-700 border-slate-200",
  drafted: "bg-amber-100 text-amber-700 border-amber-200",
  sending: "bg-blue-100 text-blue-700 border-blue-200",
  sent: "bg-emerald-100 text-emerald-700 border-emerald-200",
  dismissed: "bg-slate-100 text-slate-500 border-slate-200",
  send_failed: "bg-rose-100 text-rose-700 border-rose-200",
};

export function ReviewCard({
  review,
  showProperty,
}: {
  review: ReviewRow;
  showProperty: boolean;
}) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState(review.aiDraftText ?? "");
  const [pending, setPending] = useState(false);

  const approveAndSend = useMutation(api.guestReviews.mutations.approveAndSend);
  const dismiss = useMutation(api.guestReviews.mutations.dismiss);
  const retrySend = useMutation(api.guestReviews.mutations.retrySend);

  const canReply = review.platform === "airbnb";
  const isEditable = review.status === "drafted";

  async function handleApprove() {
    setPending(true);
    try {
      await approveAndSend({ reviewId: review._id, responseText: draft });
      showToast("Reply queued for publishing", "success");
    } catch (error) {
      showToast(`Failed to send reply: ${getErrorMessage(error)}`, "error");
    } finally {
      setPending(false);
    }
  }

  async function handleDismiss() {
    setPending(true);
    try {
      await dismiss({ reviewId: review._id });
    } catch (error) {
      showToast(`Failed to dismiss: ${getErrorMessage(error)}`, "error");
    } finally {
      setPending(false);
    }
  }

  async function handleRetry() {
    setPending(true);
    try {
      await retrySend({ reviewId: review._id, responseText: draft });
      showToast("Retrying send…", "success");
    } catch (error) {
      showToast(`Retry failed: ${getErrorMessage(error)}`, "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-[var(--card)] p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`h-4 w-4 ${i < review.rating ? "fill-amber-400 text-amber-400" : "text-slate-300"}`}
              />
            ))}
          </div>
          <span className="text-sm font-medium">
            {review.guestFirstName} {review.guestLastName}
          </span>
          {showProperty && review.propertyName && (
            <span className="text-xs text-[var(--muted-foreground)]">· {review.propertyName}</span>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_CLASS[review.status]}`}>
          {STATUS_LABEL[review.status]}
        </span>
      </div>

      <p className="text-sm text-[var(--foreground)]">{review.publicReview}</p>

      {!canReply && (
        <p className="text-xs text-[var(--muted-foreground)] italic">
          Direct booking — no OTA reply target, read-only.
        </p>
      )}

      {canReply && review.status === "send_failed" && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2">
          {review.sendError ?? "Send failed."}
        </div>
      )}

      {canReply && (review.status === "drafted" || review.status === "send_failed") && (
        <textarea
          className="w-full rounded-md border p-2 text-sm"
          rows={3}
          value={draft}
          disabled={!isEditable && review.status !== "send_failed"}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}

      {canReply && review.status === "sent" && review.respondedText && (
        <div className="text-sm bg-emerald-50 border border-emerald-200 rounded-md p-2">
          {review.respondedText}
        </div>
      )}

      {canReply && review.status === "drafted" && (
        <div className="flex gap-2">
          <button
            onClick={handleApprove}
            disabled={pending || !draft.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Approve &amp; Send
          </button>
          <button
            onClick={handleDismiss}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Dismiss
          </button>
        </div>
      )}

      {canReply && review.status === "send_failed" && (
        <div className="flex gap-2">
          <button
            onClick={handleRetry}
            disabled={pending || !draft.trim()}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Retry Send
          </button>
          <button
            onClick={handleDismiss}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
