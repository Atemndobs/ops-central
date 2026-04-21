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
import { ExternalLink, Image as ImageIcon, Languages, Loader2, Paperclip, Send } from "lucide-react";

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

type MessageLocale = "en" | "es";

type ThreadMessage = {
  _id: Id<"conversationMessages">;
  body: string;
  sourceLang?: MessageLocale | null;
  translations?: Partial<Record<MessageLocale, string>> | null;
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
  linkedJob?: {
    _id: Id<"cleaningJobs">;
    status?: string;
    scheduledStartAt?: number;
  } | null;
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
  const translateMessage = useAction(api.translation.actions.translateMessage);
  const { showToast } = useToast();
  const rawLocale = useLocale();
  const myLocale: MessageLocale = rawLocale === "es" ? "es" : "en";
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
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--foreground)]">{headerTitle}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted-foreground)]">
            {detail.linkedJob ? (
              <Link
                href={`/jobs/${detail.linkedJob._id}`}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-[11px] font-medium text-[var(--primary)] transition-colors hover:border-[var(--primary)]/50 hover:bg-[var(--primary)]/10"
              >
                <ExternalLink className="h-3 w-3" />
                <span>
                  {detail.linkedJob.scheduledStartAt
                    ? new Date(detail.linkedJob.scheduledStartAt).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      }) +
                      " · " +
                      new Date(detail.linkedJob.scheduledStartAt).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "View job"}
                </span>
                {detail.linkedJob.status ? (
                  <span className="text-[var(--muted-foreground)]">
                    · {detail.linkedJob.status.replace(/_/g, " ")}
                  </span>
                ) : null}
              </Link>
            ) : (
              <span>Thread</span>
            )}
            {detail.property ? <span>· {detail.property.name}</span> : null}
            {detail.messagingEndpoint?.phoneNumber ? (
              <span>· {detail.messagingEndpoint.phoneNumber}</span>
            ) : null}
          </div>
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
            className="shrink-0 text-xs font-medium text-[var(--primary)] hover:opacity-80"
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
                    <TranslatedMessageBody
                      messageId={message._id}
                      body={message.body}
                      sourceLang={message.sourceLang ?? "en"}
                      cached={message.translations ?? null}
                      myLocale={myLocale}
                      isSelf={isSelf}
                      translate={translateMessage}
                    />

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
                sourceLang: myLocale,
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

/**
 * Renders a message body in the viewer's locale. If the message's sourceLang
 * differs from myLocale:
 *   - If a cached translation exists, show it with a "Show original" toggle.
 *   - Otherwise, show the source as a placeholder and kick off the translate
 *     action in the background; once Convex's reactive query picks up the
 *     cached translation, the parent re-renders and we display it.
 * Never retranslates in both directions (avoids loops); skips entirely when
 * sender and viewer share a locale.
 */
function TranslatedMessageBody({
  messageId,
  body,
  sourceLang,
  cached,
  myLocale,
  isSelf,
  translate,
}: {
  messageId: Id<"conversationMessages">;
  body: string;
  sourceLang: MessageLocale;
  cached: Partial<Record<MessageLocale, string>> | null;
  myLocale: MessageLocale;
  isSelf: boolean;
  translate: (args: {
    messageId: Id<"conversationMessages">;
    targetLang: MessageLocale;
  }) => Promise<string | null>;
}) {
  const needsTranslation = sourceLang !== myLocale;
  const translated = needsTranslation ? cached?.[myLocale] ?? null : null;
  const [showOriginal, setShowOriginal] = useState(false);
  const [fetching, setFetching] = useState(false);
  const requestedRef = useRef<string | null>(null);

  // Kick off the translation once per message when the cache is empty.
  useEffect(() => {
    if (!needsTranslation) return;
    if (translated) return;
    if (requestedRef.current === messageId) return;
    requestedRef.current = messageId;
    setFetching(true);
    translate({ messageId, targetLang: myLocale })
      .catch(() => {
        /* soft-fail: parent keeps showing source */
      })
      .finally(() => setFetching(false));
  }, [messageId, needsTranslation, translated, translate, myLocale]);

  // Same locale — nothing to do.
  if (!needsTranslation) {
    return <p className="whitespace-pre-wrap text-sm">{body}</p>;
  }

  const display = showOriginal ? body : translated ?? body;
  const canToggle = Boolean(translated);
  const toggleClass = isSelf
    ? "text-[var(--primary-foreground)]/70 hover:text-[var(--primary-foreground)]"
    : "text-[var(--primary)] hover:underline";

  return (
    <div>
      <p className="whitespace-pre-wrap text-sm">{display}</p>
      <div
        className={`mt-1 flex items-center gap-1.5 text-[10px] ${
          isSelf
            ? "text-[var(--primary-foreground)]/70"
            : "text-[var(--muted-foreground)]"
        }`}
      >
        {fetching && !translated ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Translating…</span>
          </>
        ) : translated ? (
          <>
            <Languages className="h-3 w-3" />
            <span>
              {showOriginal
                ? `Translated from ${sourceLang.toUpperCase()}`
                : `Translated from ${sourceLang.toUpperCase()}`}
            </span>
            {canToggle ? (
              <button
                type="button"
                onClick={() => setShowOriginal((v) => !v)}
                className={`font-semibold ${toggleClass}`}
              >
                · {showOriginal ? "Show translation" : "Show original"}
              </button>
            ) : null}
          </>
        ) : (
          <>
            <Languages className="h-3 w-3" />
            <span>Translation unavailable — showing original</span>
          </>
        )}
      </div>
    </div>
  );
}
