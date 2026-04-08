"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";

function formatMessageTime(timestamp: number) {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ConversationThreadProps = {
  conversationId?: Id<"conversations"> | null;
  fullHref?: string | null;
  compact?: boolean;
};

export function ConversationThread({
  conversationId,
  fullHref,
  compact = false,
}: ConversationThreadProps) {
  const detail = useQuery(
    api.conversations.queries.getConversationById,
    conversationId ? { conversationId } : "skip",
  );
  const sendMessage = useMutation(api.conversations.mutations.sendMessage);
  const markRead = useMutation(api.conversations.mutations.markConversationRead);
  const { showToast } = useToast();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!conversationId || !detail?.unread) {
      return;
    }

    void markRead({ conversationId }).catch((error) => {
      console.warn("[Conversations] Failed to mark conversation read", error);
    });
  }, [conversationId, detail?.unread, markRead]);

  const messages = useMemo(() => detail?.messages ?? [], [detail?.messages]);

  if (!conversationId) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted-foreground)]">
        No conversation yet.
      </div>
    );
  }

  if (detail === undefined) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted-foreground)]">
        Loading conversation...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted-foreground)]">
        Conversation not found.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">
            {detail.property?.name ?? "Job conversation"}
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {detail.linkedJob ? `Job ${String(detail.linkedJob._id).slice(-8)}` : "Internal thread"}
          </p>
        </div>
        {fullHref ? (
          <Link
            href={fullHref}
            className="text-xs font-medium text-[var(--primary)] hover:opacity-80"
          >
            Open inbox
          </Link>
        ) : null}
      </div>

      <div className={compact ? "max-h-56 overflow-y-auto p-4" : "max-h-[28rem] overflow-y-auto p-4"}>
        {messages.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No messages yet. Start the thread.
          </p>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => {
              const isSelf = detail.selfParticipant?.userId === message.authorUserId;
              return (
                <div
                  key={message._id}
                  className={`rounded-lg border px-3 py-2 ${
                    isSelf
                      ? "border-[var(--primary)]/30 bg-[var(--primary)]/10"
                      : "border-[var(--border)] bg-[var(--background)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-[var(--foreground)]">
                      {message.author?.name ?? message.author?.email ?? "System"}
                    </p>
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      {formatMessageTime(message.createdAt)}
                    </p>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)]">
                    {message.body}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <form
        className="border-t border-[var(--border)] p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!body.trim()) {
            return;
          }

          setPending(true);
          try {
            await sendMessage({
              conversationId,
              body: body.trim(),
            });
            setBody("");
          } catch (error) {
            showToast(getErrorMessage(error, "Unable to send message."), "error");
          } finally {
            setPending(false);
          }
        }}
      >
        <label className="mb-2 block text-xs font-medium text-[var(--muted-foreground)]">
          Message
        </label>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={compact ? 2 : 3}
          placeholder="Write a message for this job..."
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]"
        />
        <div className="mt-3 flex items-center justify-end">
          <button
            type="submit"
            disabled={pending || !body.trim()}
            className="rounded-md bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          >
            {pending ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
