"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";
import { Send } from "lucide-react";

function formatMessageTime(timestamp: number) {
  const now = new Date();
  const date = new Date(timestamp);
  const isToday =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return date.toLocaleString([], {
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId || !detail?.unread) {
      return;
    }

    void markRead({ conversationId }).catch((error) => {
      console.warn("[Conversations] Failed to mark conversation read", error);
    });
  }, [conversationId, detail?.unread, markRead]);

  const messages = useMemo(() => detail?.messages ?? [], [detail?.messages]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

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
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--card)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">
            {detail.property?.name ?? "Job conversation"}
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {detail.linkedJob ? `Job ${String(detail.linkedJob._id).slice(-6)}` : "Internal thread"}
            {detail.participants && detail.participants.length > 0 ? (
              <> · {detail.participants.slice(0, 3).map((p) => p.user?.name?.split(" ")[0] ?? "").filter(Boolean).join(", ")}</>
            ) : null}
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

      {/* Messages area */}
      <div className={compact ? "max-h-56 overflow-y-auto px-4 py-3" : "min-h-[20rem] max-h-[calc(100vh-20rem)] flex-1 overflow-y-auto px-4 py-3"}>
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
            No messages yet. Start the conversation.
          </p>
        ) : (
          <div className="space-y-2">
            {messages.map((message) => {
              const isSelf = detail.selfParticipant?.userId === message.authorUserId;
              const authorName = message.author?.name?.split(" ")[0] ?? message.author?.email ?? "System";

              return (
                <div
                  key={message._id}
                  className={`flex ${isSelf ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                      isSelf
                        ? "rounded-br-sm bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "rounded-bl-sm border border-[var(--border)] bg-[var(--accent)]"
                    }`}
                  >
                    {!isSelf ? (
                      <p className={`text-[11px] font-semibold ${isSelf ? "text-[var(--primary-foreground)]/80" : "text-[var(--primary)]"}`}>
                        {authorName}
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap text-sm">
                      {message.body}
                    </p>
                    <p className={`mt-0.5 text-[10px] ${isSelf ? "text-[var(--primary-foreground)]/60 text-right" : "text-[var(--muted-foreground)]"}`}>
                      {formatMessageTime(message.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <form
        className="border-t border-[var(--border)] p-3"
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
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (body.trim()) {
                  event.currentTarget.form?.requestSubmit();
                }
              }
            }}
            rows={compact ? 1 : 2}
            placeholder="Type a message..."
            className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]"
          />
          <button
            type="submit"
            disabled={pending || !body.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
