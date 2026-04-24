"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useLocale } from "next-intl";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";
import { VoiceRecordButton } from "@/components/voice/voice-record-button";
import { Image as ImageIcon, Paperclip, Send } from "lucide-react";

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

type ThreadAttachment = {
  _id: string;
  attachmentKind: "image" | "document";
  mimeType: string;
  fileName: string;
  byteSize: number;
  caption?: string | null;
  url?: string | null;
};

type ThreadMessage = {
  _id: Id<"conversationMessages">;
  body: string;
  createdAt: number;
  authorUserId?: Id<"users">;
  author?: { name?: string | null; email?: string | null } | null;
  authorEndpoint?: { displayName?: string | null; phoneNumber: string } | null;
  attachments: ThreadAttachment[];
  transportStatus?: { currentStatus: string } | null;
};

type ConversationDetail = {
  laneKind: "internal_shared" | "whatsapp_cleaner";
  unread: boolean;
  canReplyInApp: boolean;
  linkedCleaner?: { name?: string | null } | null;
  messagingEndpoint?: {
    displayName?: string | null;
    phoneNumber?: string | null;
    serviceWindowClosesAt?: number;
  } | null;
  linkedJob?: { _id: Id<"cleaningJobs"> } | null;
  property?: { name?: string | null } | null;
  selfParticipant?: { userId?: Id<"users"> } | null;
  messages: ThreadMessage[];
};

export function ConversationThread({
  conversationId,
  fullHref,
  compact = false,
}: ConversationThreadProps) {
  const detail = useQuery(
    api.conversations.queries.getConversationById,
    conversationId ? { conversationId } : "skip",
  ) as ConversationDetail | null | undefined;
  const sendInternalMessage = useMutation(api.conversations.mutations.sendMessage);
  const sendWhatsAppReply = useAction(api.whatsapp.actions.sendReply);
  const markRead = useMutation(api.conversations.mutations.markConversationRead);
  const { showToast } = useToast();
  const locale = useLocale();
  const languageHint = locale === "es" ? "es" : "en";
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

  const isWhatsAppLane = detail.laneKind === "whatsapp_cleaner";
  const headerTitle = isWhatsAppLane
    ? `${detail.linkedCleaner?.name ?? detail.messagingEndpoint?.displayName ?? "Cleaner"} · WhatsApp`
    : detail.property?.name ?? "Job conversation";
  const canReplyInApp = detail.canReplyInApp !== false;
  const helperText = isWhatsAppLane
    ? canReplyInApp
      ? detail.messagingEndpoint?.serviceWindowClosesAt
        ? `Reply window open until ${new Date(
            detail.messagingEndpoint.serviceWindowClosesAt,
          ).toLocaleString()}`
        : "Reply window open"
      : "Await cleaner reply before sending another WhatsApp message."
    : "Internal team thread";

  return (
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">{headerTitle}</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {detail.linkedJob ? `Job ${String(detail.linkedJob._id).slice(-6)}` : "Thread"}
            {detail.property ? ` · ${detail.property.name}` : ""}
            {detail.messagingEndpoint?.phoneNumber
              ? ` · ${detail.messagingEndpoint.phoneNumber}`
              : ""}
          </p>
          <p
            className={`mt-1 text-[11px] ${
              isWhatsAppLane && canReplyInApp
                ? "text-emerald-400"
                : "text-[var(--muted-foreground)]"
            }`}
          >
            {helperText}
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

      <div
        className={
          compact
            ? "max-h-56 overflow-y-auto px-4 py-3"
            : "min-h-[20rem] max-h-[calc(100vh-20rem)] flex-1 overflow-y-auto px-4 py-3"
        }
      >
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
            No messages yet. Start the conversation.
          </p>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => {
              const isSelf = detail.selfParticipant?.userId === message.authorUserId;
              const authorName =
                message.author?.name?.split(" ")[0] ??
                message.authorEndpoint?.displayName ??
                message.authorEndpoint?.phoneNumber ??
                message.author?.email ??
                "System";

              return (
                <div
                  key={message._id}
                  className={`flex ${isSelf ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                      isSelf
                        ? "rounded-br-sm bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "rounded-bl-sm border border-[var(--border)] bg-[var(--accent)]"
                    }`}
                  >
                    {!isSelf ? (
                      <p
                        className={`text-[11px] font-semibold ${
                          isSelf
                            ? "text-[var(--primary-foreground)]/80"
                            : "text-[var(--primary)]"
                        }`}
                      >
                        {authorName}
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap text-sm">{message.body}</p>

                    {Array.isArray(message.attachments) && message.attachments.length > 0 ? (
                      <div className="mt-2 space-y-2">
                        {message.attachments.map((attachment) => (
                          <div
                            key={attachment._id}
                            className={`rounded-lg border px-2 py-2 ${
                              isSelf
                                ? "border-white/20 bg-white/10"
                                : "border-[var(--border)] bg-[var(--background)]"
                            }`}
                          >
                            {attachment.attachmentKind === "image" && attachment.url ? (
                              <a
                                href={attachment.url}
                                target="_blank"
                                rel="noreferrer"
                                className="block overflow-hidden rounded-md"
                              >
                                <Image
                                  src={attachment.url}
                                  alt={attachment.caption ?? attachment.fileName}
                                  width={960}
                                  height={720}
                                  unoptimized
                                  className="max-h-56 w-full rounded-md object-cover"
                                />
                              </a>
                            ) : null}
                            <div className="mt-2 flex items-center gap-2 text-xs">
                              {attachment.attachmentKind === "image" ? (
                                <ImageIcon className="h-3.5 w-3.5" />
                              ) : (
                                <Paperclip className="h-3.5 w-3.5" />
                              )}
                              {attachment.url ? (
                                <a
                                  href={attachment.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-medium underline-offset-2 hover:underline"
                                >
                                  {attachment.fileName}
                                </a>
                              ) : (
                                <span className="font-medium">{attachment.fileName}</span>
                              )}
                              <span className={isSelf ? "text-[var(--primary-foreground)]/60" : "text-[var(--muted-foreground)]"}>
                                {Math.max(1, Math.round((attachment.byteSize ?? 0) / 1024))} KB
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <p
                      className={`mt-1 text-[10px] ${
                        isSelf
                          ? "text-right text-[var(--primary-foreground)]/60"
                          : "text-[var(--muted-foreground)]"
                      }`}
                    >
                      {formatMessageTime(message.createdAt)}
                      {isSelf && message.transportStatus?.currentStatus
                        ? ` · ${message.transportStatus.currentStatus}`
                        : ""}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <form
        className="border-t border-[var(--border)] p-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!body.trim()) {
            return;
          }

          setPending(true);
          try {
            if (isWhatsAppLane) {
              await sendWhatsAppReply({
                conversationId,
                body: body.trim(),
              });
            } else {
              await sendInternalMessage({
                conversationId,
                body: body.trim(),
              });
            }
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
                if (body.trim() && !pending && canReplyInApp) {
                  event.currentTarget.form?.requestSubmit();
                }
              }
            }}
            rows={compact ? 1 : 2}
            disabled={pending || !canReplyInApp}
            placeholder={
              isWhatsAppLane
                ? canReplyInApp
                  ? "Reply in WhatsApp..."
                  : "Await cleaner reply..."
                : "Type a message..."
            }
            className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
          />
          <VoiceRecordButton
            disabled={pending || !canReplyInApp}
            languageHint={languageHint}
            size={compact ? "sm" : "md"}
            onTranscript={(text) => {
              // Append the transcript so a user who already started typing
              // doesn't lose their draft. Trim so we don't prepend leading
              // whitespace when appending to an empty composer.
              setBody((prev) => (prev ? `${prev} ${text}`.trim() : text));
            }}
            onError={(message) => showToast(message, "error")}
          />
          <button
            type="submit"
            disabled={pending || !body.trim() || !canReplyInApp}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
