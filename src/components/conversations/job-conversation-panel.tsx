"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";
import { ConversationThread } from "./conversation-thread";

type JobConversationPanelProps = {
  jobId: Id<"cleaningJobs">;
  fullHrefBase: "/messages" | "/cleaner/messages";
  compact?: boolean;
};

export function JobConversationPanel({
  jobId,
  fullHrefBase,
  compact = false,
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
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted-foreground)]">
        Loading conversation...
      </div>
    );
  }

  const conversationId = summary?._id ?? null;
  const fullHref =
    conversationId != null ? `${fullHrefBase}?conversationId=${conversationId}` : fullHrefBase;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Messages</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            Shared job conversation for cleaners and ops.
          </p>
        </div>
        {summary?.unread ? (
          <span className="rounded-full bg-[var(--primary)] px-2 py-1 text-[10px] font-bold text-[var(--primary-foreground)]">
            Unread
          </span>
        ) : null}
      </div>
      <ConversationThread
        conversationId={conversationId}
        fullHref={fullHref}
        compact={compact}
      />
    </div>
  );
}
