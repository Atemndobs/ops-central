"use client";

import { useState } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Star, Loader2, Send, X, RotateCcw, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";
import type { ReviewProvider } from "@convex/lib/reviewResponseDraft";
import { VoiceRecordButton } from "@/components/voice/voice-record-button";

export type ReviewRow = {
  _id: Id<"guestReviews">;
  propertyId: Id<"properties">;
  propertyName?: string;
  guestPhotoUrl?: string;
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

const STAR_COLOR: Record<number, string> = {
  5: "fill-emerald-400 text-emerald-400",
  4: "fill-blue-400 text-blue-400",
  3: "fill-amber-400 text-amber-400",
  2: "fill-orange-400 text-orange-400",
  1: "fill-rose-400 text-rose-400",
};

const PROVIDERS: { value: ReviewProvider; label: string; color: string }[] = [
  { value: "gemini", label: "Gemini", color: "border-blue-400 text-blue-700 bg-blue-50" },
  { value: "claude", label: "Claude", color: "border-amber-400 text-amber-700 bg-amber-50" },
  { value: "openai", label: "OpenAI", color: "border-emerald-400 text-emerald-700 bg-emerald-50" },
];

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

  // AI refine panel state
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [provider, setProvider] = useState<ReviewProvider>("gemini");
  const [refining, setRefining] = useState(false);

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
        instruction: refineInstruction.trim() || undefined,
        provider,
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

  return (
    <div className="rounded-2xl border bg-[var(--card)] p-5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
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
                <span className="text-xs text-[var(--muted-foreground)]">· {review.propertyName}</span>
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
        <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_CLASS[review.status]}`}>
          {STATUS_LABEL[review.status]}
        </span>
      </div>

      {/* Review text */}
      <p className="text-sm text-[var(--foreground)] leading-relaxed">{review.publicReview}</p>

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

      {/* Draft textarea */}
      {canReply && (review.status === "drafted" || review.status === "send_failed") && (
        <textarea
          className="w-full rounded-md border p-2 text-sm resize-y"
          rows={3}
          value={draft}
          disabled={!isEditable}
          onChange={(e) => setDraft(e.target.value)}
        />
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
          {refineOpen && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-3">
              {/* Provider selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted-foreground)] shrink-0">Provider:</span>
                {PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setProvider(p.value)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      provider === p.value ? p.color : "hover:bg-[var(--muted)]"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Instruction */}
              <div>
                <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                  Refinement instruction (optional)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder='e.g. "Be more apologetic about the cleanliness issue" or leave blank to auto-improve'
                    value={refineInstruction}
                    onChange={(e) => setRefineInstruction(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !refining && handleRefine()}
                    className="flex-1 rounded-md border px-2.5 py-1.5 text-sm bg-[var(--background)]"
                  />
                  <VoiceRecordButton
                    size="sm"
                    onTranscript={(text) => setRefineInstruction((prev) => prev ? `${prev} ${text}` : text)}
                    onError={(msg) => showToast(msg, "error")}
                    disabled={refining}
                  />
                </div>
              </div>

              <button
                onClick={handleRefine}
                disabled={refining}
                className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {refining ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {refining ? "Refining…" : "Regenerate draft"}
              </button>
            </div>
          )}
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

          {refineOpen && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted-foreground)] shrink-0">Provider:</span>
                {PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setProvider(p.value)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      provider === p.value ? p.color : "hover:bg-[var(--muted)]"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder='e.g. "Be more apologetic about the cleanliness issue"'
                  value={refineInstruction}
                  onChange={(e) => setRefineInstruction(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !refining && handleRefine()}
                  className="flex-1 rounded-md border px-2.5 py-1.5 text-sm bg-[var(--background)]"
                />
                <VoiceRecordButton
                  size="sm"
                  onTranscript={(text) => setRefineInstruction((prev) => prev ? `${prev} ${text}` : text)}
                  onError={(msg) => showToast(msg, "error")}
                  disabled={refining}
                />
              </div>
              <button
                onClick={handleRefine}
                disabled={refining}
                className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {refining ? "Refining…" : "Regenerate draft"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
