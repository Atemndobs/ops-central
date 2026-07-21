"use client";

import { useEffect, useState } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Star, Loader2, Send, X, RotateCcw, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";
import type { ReviewProvider } from "@convex/lib/reviewResponseDraft";
import { RefinePanel } from "./refine-panel";

export type ReviewRow = {
  _id: Id<"guestReviews">;
  propertyId: Id<"properties">;
  propertyName?: string;
  guestPhotoUrl?: string;
  platform: "airbnb" | "direct";
  rating: number;
  publicReview: string;
  privateFeedback?: string;
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

const STAR_COLOR: Record<number, string> = {
  5: "fill-emerald-400 text-emerald-400",
  4: "fill-blue-400 text-blue-400",
  3: "fill-amber-400 text-amber-400",
  2: "fill-orange-400 text-orange-400",
  1: "fill-rose-400 text-rose-400",
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

  useEffect(() => {
    setDraft(review.aiDraftText ?? "");
  }, [review._id, review.aiDraftText]);

  // AI refine panel state
  const [refineOpen, setRefineOpen] = useState(false);
  const [provider, setProvider] = useState<ReviewProvider>("gemini");
  const [refining, setRefining] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState("");
  // Template dropdowns
  const reviewCategory =
    review.rating >= 5 ? "glowing_5star"
    : review.rating >= 4 ? "positive_4star"
    : review.rating >= 3 ? "mixed_3star"
    : "critical_2star";
  const [incentive, setIncentive] = useState("none");
  const [tone, setTone] = useState("professional");
  const [length, setLength] = useState(
    review.rating >= 4 ? "short" : "standard"
  );

  const approveAndSend = useMutation(api.guestReviews.mutations.approveAndSend);
  const dismiss = useMutation(api.guestReviews.mutations.dismiss);
  const retrySend = useMutation(api.guestReviews.mutations.retrySend);
  const refineAction = useAction(api.guestReviews.actions.refineReviewDraft);

  const canReply = review.platform === "airbnb";
  const isEditable = review.status === "drafted" || review.status === "send_failed";
  const starColor = STAR_COLOR[review.rating] ?? "fill-amber-400 text-amber-400";

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

  async function handleRefine() {
    setRefining(true);
    try {
      const newDraft = await refineAction({
        reviewId: review._id,
        currentDraft: draft,
        provider,
        reviewCategory: reviewCategory as "glowing_5star" | "positive_4star" | "mixed_3star" | "critical_2star",
        incentive: incentive as "none" | "return_discount" | "google_review" | "early_late_checkin",
        tone,
        length,
        instruction: refineInstruction.trim() || undefined,
      });
      setDraft(newDraft);
      setRefineOpen(false);
      setRefineInstruction("");
      showToast(`Draft refined with ${provider === "gemini" ? "Gemini" : provider === "claude" ? "Claude" : "OpenAI"}`, "success");
    } catch (error) {
      showToast(`AI refinement failed: ${getErrorMessage(error)}`, "error");
    } finally {
      setRefining(false);
    }
  }

  const isBadReview = review.rating <= 3;
  const isUrgent = isBadReview && (review.status === "needs_draft" || review.status === "send_failed");
  const isRespondNeeded = isBadReview && review.status === "drafted";

  return (
    <div className={`rounded-2xl border bg-[var(--card)] p-5 space-y-3 ${
      isUrgent ? "border-l-4 border-l-rose-500" : isRespondNeeded ? "border-l-4 border-l-amber-400" : ""
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Guest avatar */}
          {review.guestPhotoUrl ? (
            <img
              src={review.guestPhotoUrl}
              alt={`${review.guestFirstName} ${review.guestLastName}`}
              className="h-9 w-9 rounded-full object-cover shrink-0 ring-1 ring-[var(--border)]"
            />
          ) : (
            <div className="h-9 w-9 rounded-full bg-[var(--muted)] flex items-center justify-center shrink-0 ring-1 ring-[var(--border)]">
              <span className="text-xs font-semibold text-[var(--muted-foreground)] select-none">
                {review.guestFirstName[0]}{review.guestLastName[0]}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-medium">
                {review.guestFirstName} {review.guestLastName}
              </span>
              {showProperty && review.propertyName && (
                <span className="text-xs text-[var(--muted-foreground)] truncate">· {review.propertyName}</span>
              )}
            </div>
            <div className="flex items-center gap-0.5 mt-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`h-3.5 w-3.5 ${i < review.rating ? starColor : "text-slate-300"}`}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isUrgent && (
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-rose-600 text-white">
              P1 Urgent
            </span>
          )}
          {isRespondNeeded && (
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-500 text-white">
              P2 Respond
            </span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_CLASS[review.status]}`}>
            {STATUS_LABEL[review.status]}
          </span>
        </div>
      </div>

      {/* What the guest wrote: their words, neutral/muted color */}
      <div className="rounded-md border-l-[3px] border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/40 pl-3 pr-2.5 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Guest wrote</p>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{review.publicReview}</p>
        {review.privateFeedback && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed whitespace-pre-wrap border-t border-slate-200 dark:border-slate-700 pt-2">
            <span className="font-semibold">Private note to host:</span> {review.privateFeedback}
          </p>
        )}
      </div>

      {!canReply && (
        <p className="text-xs text-[var(--muted-foreground)] italic">
          Direct booking: no OTA reply target, read-only.
        </p>
      )}

      {canReply && review.status === "send_failed" && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2">
          {review.sendError ?? "Send failed."}
        </div>
      )}

      {/* Our response: large field, emerald = "us", clearly distinct from the guest's neutral text */}
      {canReply && (review.status === "drafted" || review.status === "send_failed") && (
        <div className="rounded-md border-l-[3px] border-emerald-400 bg-emerald-50/60 dark:border-emerald-500 dark:bg-emerald-900/10 pl-3 pr-2.5 py-2 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            Your response · ready to send
          </p>
          <textarea
            className="w-full rounded-md border border-emerald-200 dark:border-emerald-800 bg-[var(--card)] p-3 text-sm leading-relaxed text-emerald-900 dark:text-emerald-100 resize-y min-h-[180px] focus:outline-none focus:ring-2 focus:ring-emerald-400/50"
            rows={8}
            value={draft}
            disabled={!isEditable}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
      )}

      {/* Sent response */}
      {canReply && review.status === "sent" && review.respondedText && (
        <div className="text-sm bg-emerald-50 border border-emerald-200 rounded-md p-2">
          {review.respondedText}
        </div>
      )}

      {/* Action buttons */}
      {canReply && review.status === "drafted" && (
        <div className="space-y-2">
          <div className="flex gap-2 flex-wrap">
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
            <button
              onClick={() => setRefineOpen((o) => !o)}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md border border-violet-300 px-3 py-1.5 text-sm text-violet-700 hover:bg-violet-50 disabled:opacity-50 ml-auto"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Refine with AI
              {refineOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>

          {/* Refine panel */}
          {refineOpen && <RefinePanel
            incentive={incentive} setIncentive={setIncentive}
            tone={tone} setTone={setTone}
            length={length} setLength={setLength}
            provider={provider} setProvider={setProvider}
            refineInstruction={refineInstruction} setRefineInstruction={setRefineInstruction}
            refining={refining} onRefine={handleRefine}
          />}
        </div>
      )}

      {canReply && review.status === "send_failed" && (
        <div className="space-y-2">
          <div className="flex gap-2 flex-wrap">
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
            <button
              onClick={() => setRefineOpen((o) => !o)}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md border border-violet-300 px-3 py-1.5 text-sm text-violet-700 hover:bg-violet-50 disabled:opacity-50 ml-auto"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Refine with AI
              {refineOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>

          {refineOpen && <RefinePanel
            incentive={incentive} setIncentive={setIncentive}
            tone={tone} setTone={setTone}
            length={length} setLength={setLength}
            provider={provider} setProvider={setProvider}
            refineInstruction={refineInstruction} setRefineInstruction={setRefineInstruction}
            refining={refining} onRefine={handleRefine}
          />}
        </div>
      )}
    </div>
  );
}
