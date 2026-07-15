"use client";

import { useState } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Star, Loader2, Send, X, RotateCcw, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";
import type { ReviewProvider } from "@convex/lib/reviewResponseDraft";

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

// Styled select that respects CSS var tokens and avoids native browser chrome.
function AppSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label className="text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
        {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] px-2.5 py-1.5 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
      </div>
    </div>
  );
}

type RefinePanelProps = {
  reviewCategory: string; setReviewCategory: (v: string) => void;
  incentive: string; setIncentive: (v: string) => void;
  tone: string; setTone: (v: string) => void;
  provider: ReviewProvider; setProvider: (v: ReviewProvider) => void;
  refineInstruction: string; setRefineInstruction: (v: string) => void;
  refining: boolean; onRefine: () => void;
};

function RefinePanel({
  reviewCategory, setReviewCategory,
  incentive, setIncentive,
  tone, setTone,
  provider, setProvider,
  refineInstruction, setRefineInstruction,
  refining, onRefine,
}: RefinePanelProps) {
  return (
    <div className="rounded-xl border border-violet-200 bg-[var(--background)] p-3 space-y-3 shadow-sm">
      {/* Single row: all 3 dropdowns + provider */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[110px]">
          <AppSelect
            label="Review type"
            value={reviewCategory}
            onChange={setReviewCategory}
            options={[
              { value: "glowing_5star", label: "5★ Glowing" },
              { value: "positive_4star", label: "4★ Positive" },
              { value: "mixed_3star", label: "3★ Mixed" },
              { value: "critical_2star", label: "2★ Critical" },
            ]}
          />
        </div>
        <div className="flex-1 min-w-[130px]">
          <AppSelect
            label="Incentive"
            value={incentive}
            onChange={setIncentive}
            options={[
              { value: "none", label: "None" },
              { value: "return_discount", label: "10% return discount" },
              { value: "google_review", label: "Google review ask" },
              { value: "early_late_checkin", label: "Early/late check-in" },
            ]}
          />
        </div>
        <div className="flex-1 min-w-[110px]">
          <AppSelect
            label="Tone"
            value={tone}
            onChange={setTone}
            options={[
              { value: "professional", label: "Professional" },
              { value: "warm and friendly", label: "Warm" },
              { value: "brief and concise", label: "Brief" },
              { value: "empathetic", label: "Empathetic" },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <label className="text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
            Provider
          </label>
          <div className="flex items-center gap-1.5">
            {PROVIDERS.map((p) => (
              <button
                key={p.value}
                onClick={() => setProvider(p.value)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  provider === p.value ? p.color : "border-[var(--border)] hover:bg-[var(--muted)] text-[var(--foreground)]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Free-text instruction */}
      <div>
        <label className="block text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-1">
          Additional instruction (optional)
        </label>
        <input
          type="text"
          placeholder='e.g. "Mention the rooftop view specifically" or leave blank to use template blocks'
          value={refineInstruction}
          onChange={(e) => setRefineInstruction(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !refining && onRefine()}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] px-2.5 py-1.5 text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-violet-400"
        />
      </div>

      <button
        onClick={onRefine}
        disabled={refining}
        className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
      >
        {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {refining ? "Refining…" : "Regenerate draft"}
      </button>
    </div>
  );
}

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
  const [provider, setProvider] = useState<ReviewProvider>("gemini");
  const [refining, setRefining] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState("");
  // Template dropdowns
  const [reviewCategory, setReviewCategory] = useState<string>(() =>
    review.rating >= 5 ? "glowing_5star"
    : review.rating >= 4 ? "positive_4star"
    : review.rating >= 3 ? "mixed_3star"
    : "critical_2star"
  );
  const [incentive, setIncentive] = useState("none");
  const [tone, setTone] = useState("professional");

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
          {refineOpen && <RefinePanel
            reviewCategory={reviewCategory} setReviewCategory={setReviewCategory}
            incentive={incentive} setIncentive={setIncentive}
            tone={tone} setTone={setTone}
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
            reviewCategory={reviewCategory} setReviewCategory={setReviewCategory}
            incentive={incentive} setIncentive={setIncentive}
            tone={tone} setTone={setTone}
            provider={provider} setProvider={setProvider}
            refineInstruction={refineInstruction} setRefineInstruction={setRefineInstruction}
            refining={refining} onRefine={handleRefine}
          />}
        </div>
      )}
    </div>
  );
}
