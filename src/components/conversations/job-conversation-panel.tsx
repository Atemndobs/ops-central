"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";
import { MessageSquare, ArrowRight } from "lucide-react";

function formatPreviewTime(timestamp?: number) {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

type JobConversationPanelProps = {
  jobId: Id<"cleaningJobs">;
  fullHrefBase: "/messages" | "/cleaner/messages";
  compact?: boolean;
};

export function JobConversationPanel({
  jobId,
  fullHrefBase,
}: JobConversationPanelProps) {
  const summary = useQuery(api.conversations.queries.getConversationForJob, { jobId });
  const ensureConversation = useMutation(api.conversations.mutations.ensureJobConversation);
  const ensureAttemptedRef = useRef(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (summary !== null || ensureAttemptedRef.current) {
      return;
    }

    ensureAttemptedRef.current = true;
    void ensureConversation({ jobId }).catch((error) => {
      ensureAttemptedRef.current = false;
      showToast(getErrorMessage(error, "Unable to open conversation."), "error");
    });
  }, [ensureConversation, jobId, showToast, summary]);

  if (summary === undefined) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <MessageSquare className="h-4 w-4" />
          Loading messages...
        </div>
      </div>
    );
  }

  const conversationId = summary?._id ?? null;
  const fullHref =
    conversationId != null ? `${fullHrefBase}?conversationId=${conversationId}` : fullHrefBase;
  const hasMessages = summary && summary.lastMessagePreview;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Messages</h3>
          {summary?.unread ? (
            <span className="inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[var(--destructive)] px-1.5 text-[10px] font-bold text-white">
              New
            </span>
          ) : null}
        </div>
        <Link
          href={fullHref}
          className="flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:opacity-80"
        >
          {hasMessages ? "Open conversation" : "Start conversation"}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {hasMessages ? (
        <Link
          href={fullHref}
          className="block rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 transition-colors hover:bg-[var(--accent)]"
        >
          <div className="flex items-start justify-between gap-3">
            <p className={`flex-1 truncate text-sm ${summary.unread ? "font-semibold text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>
              {summary.lastMessagePreview}
            </p>
            <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">
              {formatPreviewTime(summary.lastMessageAt)}
            </span>
          </div>
        </Link>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] p-3">
          <p className="text-xs text-[var(--muted-foreground)]">
            No messages yet for this job.
          </p>
        </div>
      )}
    </div>
  );
}
