"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";
import { VoiceRecordButton } from "@/components/voice/voice-record-button";
import { VideoPlayer } from "@/components/media/VideoPlayer";
import { useIsVideoEnabled } from "@/hooks/use-is-video-enabled";
import { ExternalLink, Image as ImageIcon, Languages, Loader2, Mic, Paperclip, Send, Video as VideoIcon, X as XIcon } from "lucide-react";

/**
 * Phase 4a — outbound video composer support.
 *
 * Probe a local video file for duration + dimensions via a hidden
 * `<video>` element. Returns nulls if the browser can't decode the
 * source — server-side validation is the safety net, not this probe.
 */
async function probeLocalVideo(file: File): Promise<{
  durationMs: number | null;
  width: number | null;
  height: number | null;
}> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.src = "";
      video.load();
    };
    video.onloadedmetadata = () => {
      const out = {
        durationMs: Number.isFinite(video.duration)
          ? Math.round(video.duration * 1000)
          : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      };
      cleanup();
      resolve(out);
    };
    video.onerror = () => {
      cleanup();
      resolve({ durationMs: null, width: null, height: null });
    };
    video.src = url;
  });
}

/** Hard cap surfaced to the user. Stays in sync with mediaValidation
 *  ceilings on the backend (60 s / 25 MiB per ADR-0003). */
const COMPOSER_MAX_VIDEO_SECONDS = 60;
const COMPOSER_MAX_VIDEO_BYTES = 25 * 1024 * 1024;

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
  /**
   * Fill the parent's height instead of using viewport-based max-height.
   * Enables mobile-app style: header + composer pinned, messages scroll.
   */
  fillHeight?: boolean;
};

type ThreadAttachment = {
  _id: string;
  /** "video" added in Phase 4a of video-support — covers both outbound
   *  cleaner/admin-recorded video AND inbound WhatsApp/SMS video stored
   *  as-is per ADR-0003. */
  attachmentKind: "image" | "document" | "audio" | "video";
  mimeType: string;
  fileName: string;
  byteSize: number;
  caption?: string | null;
  url?: string | null;
  /** Only populated when attachmentKind === "audio". */
  audioDurationMs?: number | null;
  /** Phase 4a: video-only metadata. Posters may be absent on inbound
   *  WhatsApp video (we don't extract one client-side), in which case
   *  the player falls back to a generic frame from the video itself. */
  videoDurationMs?: number | null;
  posterUrl?: string | null;
  width?: number | null;
  height?: number | null;
};

type MessageLocale = "en" | "es";

type ThreadMessage = {
  _id: Id<"conversationMessages">;
  body: string;
  sourceLang?: MessageLocale | null;
  translations?: Partial<Record<MessageLocale, string>> | null;
  createdAt: number;
  authorUserId?: Id<"users">;
  author?: {
    name?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
  } | null;
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
  fillHeight = false,
}: ConversationThreadProps) {
  const detail = useQuery(
    api.conversations.queries.getConversationById,
    conversationId ? { conversationId } : "skip",
  ) as ConversationDetail | null | undefined;
  // Phase 4a video-support — gates inline video playback on conversation
  // attachments. When off, video attachments fall through to the
  // "Download" / external-link affordance like documents do.
  const videoEnabled = useIsVideoEnabled();
  const sendInternalMessage = useMutation(api.conversations.mutations.sendMessage);
  const sendWhatsAppReply = useAction(api.whatsapp.actions.sendReply);
  const markRead = useMutation(api.conversations.mutations.markConversationRead);
  const translateMessage = useAction(api.translation.actions.translateMessage);
  const { showToast } = useToast();
  const t = useTranslations();
  const rawLocale = useLocale();
  const myLocale: MessageLocale = rawLocale === "es" ? "es" : "en";
  // Admin-controlled flag. When off (default), the voice-to-text mic button
  // is hidden from the composer. Follow the same pattern for every new
  // user-facing feature — ship behind a flag, let admin flip it when ready.
  const voiceMessagesEnabled = useQuery(
    api.admin.featureFlags.isFeatureEnabled,
    { key: "voice_messages" },
  );
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  // Holds the retained-audio metadata returned by the transcribe action
  // when the `voice_audio_attachments` flag is ON. When populated, the
  // composer shows a "voice message attached" chip and the submit handler
  // passes the audio along to sendMessage so the playback bubble lands on
  // the posted message. Cleared after send/cancel/restart.
  const [pendingAudio, setPendingAudio] = useState<{
    storageId: string;
    mimeType: string;
    byteSize: number;
    durationMs: number;
  } | null>(null);
  // Phase 4a — pending video attachment, set by the +Video button after
  // the user selects + uploads a clip. Sent on next submit, cleared on
  // send/cancel.
  const [pendingVideo, setPendingVideo] = useState<{
    storageId: string;
    mimeType: string;
    byteSize: number;
    fileName: string;
    durationMs: number | null;
    width: number | null;
    height: number | null;
  } | null>(null);
  const [videoUploading, setVideoUploading] = useState(false);
  const generateUploadUrl = useMutation(api.files.mutations.generateUploadUrl);
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
    <div
      className={`msg-thread-root flex flex-col rounded-2xl border border-[var(--msg-divider,var(--border))] bg-[var(--msg-card,var(--card))] shadow-[var(--msg-shadow-card,none)] ${
        fillHeight ? "h-full min-h-0" : ""
      }`}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--msg-divider,var(--border))] px-4 py-3">
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
            : fillHeight
              ? "min-h-0 flex-1 overflow-y-auto px-4 py-3"
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
              // Sender avatar — only rendered for non-self messages, sits to
              // the left of the bubble. Falls back to initials chip when the
              // backend doesn't have an avatarUrl yet (mirror of the mobile
              // JobConversationCard fallback so both surfaces stay consistent).
              const avatarUrl = message.author?.avatarUrl ?? null;
              const avatarInitials = (() => {
                const source = (
                  message.author?.name ??
                  message.author?.email ??
                  message.authorEndpoint?.displayName ??
                  message.authorEndpoint?.phoneNumber ??
                  "?"
                ).trim();
                const parts = source.split(/\s+/).filter(Boolean);
                if (parts.length === 0) return source.slice(0, 1).toUpperCase();
                if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
                return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
              })();

              return (
                <div
                  key={message._id}
                  className={`flex items-end gap-2 ${isSelf ? "justify-end" : "justify-start"}`}
                >
                  {!isSelf ? (
                    avatarUrl ? (
                      <span
                        aria-hidden
                        className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full"
                      >
                        <Image
                          src={avatarUrl}
                          alt=""
                          fill
                          sizes="28px"
                          unoptimized
                          className="object-cover"
                        />
                      </span>
                    ) : (
                      <span
                        aria-hidden
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--msg-primary,var(--primary))] text-[10px] font-bold text-white"
                      >
                        {avatarInitials}
                      </span>
                    )
                  ) : null}
                  <div
                    className={`max-w-[85%] rounded-[12px] px-3 py-2 text-[var(--msg-text,var(--foreground))] ${
                      isSelf
                        ? "rounded-br-[4px] border border-[var(--msg-bubble-border,var(--border))] bg-[var(--msg-bubble-out,var(--card))]"
                        : "rounded-bl-[4px] bg-[var(--msg-bubble-in,var(--accent))]"
                    }`}
                  >
                    {!isSelf ? (
                      <p
                        className="text-[11px] font-semibold"
                        style={{ color: "var(--msg-primary-strong, var(--primary))" }}
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
                            {attachment.attachmentKind === "audio" && attachment.url ? (
                              <audio
                                controls
                                preload="metadata"
                                src={attachment.url}
                                className="w-full max-w-[280px]"
                              >
                                {/* Fallback for browsers without <audio> */}
                                <a
                                  href={attachment.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {attachment.fileName}
                                </a>
                              </audio>
                            ) : null}
                            {/* Phase 4a video-support — inline player when
                                the master flag is on. Inbound WhatsApp video
                                may carry a non-canonical MIME (HEVC, 3GPP);
                                the browser handles it natively where it can,
                                otherwise the "Download" link below acts as
                                the universal fallback. */}
                            {attachment.attachmentKind === "video" &&
                            attachment.url &&
                            videoEnabled ? (
                              <VideoPlayer
                                src={attachment.url}
                                poster={attachment.posterUrl ?? null}
                                durationMs={attachment.videoDurationMs ?? undefined}
                                ariaLabel={attachment.caption ?? attachment.fileName}
                                className="max-h-72 w-full max-w-[480px] rounded-md object-contain"
                              />
                            ) : null}
                            <div className="mt-2 flex items-center gap-2 text-xs">
                              {attachment.attachmentKind === "image" ? (
                                <ImageIcon className="h-3.5 w-3.5" />
                              ) : attachment.attachmentKind === "audio" ? (
                                <Mic className="h-3.5 w-3.5" />
                              ) : attachment.attachmentKind === "video" ? (
                                <VideoIcon className="h-3.5 w-3.5" />
                              ) : (
                                <Paperclip className="h-3.5 w-3.5" />
                              )}
                              {attachment.attachmentKind === "audio" ? (
                                <span className="font-medium">
                                  {attachment.audioDurationMs
                                    ? t("voice.attachmentLabel", {
                                        duration: `${Math.floor(attachment.audioDurationMs / 60000)}:${String(Math.floor((attachment.audioDurationMs % 60000) / 1000)).padStart(2, "0")}`,
                                      })
                                    : t("voice.attachmentLabelNoDuration")}
                                </span>
                              ) : attachment.url ? (
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
                      className={`mt-1 text-[10px] text-[var(--msg-text-muted,var(--muted-foreground))] ${
                        isSelf ? "text-right" : ""
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
        className="shrink-0 border-t border-[var(--msg-divider,var(--border))] p-3"
        onSubmit={async (event) => {
          event.preventDefault();
          // Phase 4a — allow sending when there's either body text OR a
          // video attachment ready. Audio still requires body text from
          // the transcribe action.
          if (!body.trim() && !pendingVideo) {
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
                // storageId is a branded Id<"_storage"> on the server side;
                // the client has it as a plain string from Convex storage.
                // The server re-validates, so a localized cast is safe.
                audioAttachment: pendingAudio
                  ? {
                      storageId: pendingAudio.storageId as Id<"_storage">,
                      mimeType: pendingAudio.mimeType,
                      byteSize: pendingAudio.byteSize,
                      durationMs: pendingAudio.durationMs,
                    }
                  : undefined,
                videoAttachment: pendingVideo
                  ? {
                      storageId: pendingVideo.storageId as Id<"_storage">,
                      mimeType: pendingVideo.mimeType,
                      byteSize: pendingVideo.byteSize,
                      fileName: pendingVideo.fileName,
                      durationMs: pendingVideo.durationMs ?? undefined,
                      width: pendingVideo.width ?? undefined,
                      height: pendingVideo.height ?? undefined,
                    }
                  : undefined,
              });
            }
            setBody("");
            setPendingAudio(null);
            setPendingVideo(null);
          } catch (error) {
            showToast(getErrorMessage(error, "Unable to send message."), "error");
          } finally {
            setPending(false);
          }
        }}
      >
        {pendingAudio ? (
          <div className="mb-2 flex items-center gap-2 rounded-full border border-[var(--msg-primary,var(--primary))]/30 bg-[var(--msg-primary,var(--primary))]/10 px-3 py-1.5 text-xs font-medium text-[var(--msg-primary,var(--primary))]">
            <Mic className="h-3.5 w-3.5" />
            <span>
              {/* e.g. "Voice · 0:08" — concise indicator; full player only
                  renders once the message is actually posted. */}
              {t("voice.attachmentLabel", {
                duration: `${Math.floor(pendingAudio.durationMs / 60000)}:${String(
                  Math.floor((pendingAudio.durationMs % 60000) / 1000),
                ).padStart(2, "0")}`,
              })}
            </span>
            <button
              type="button"
              onClick={() => setPendingAudio(null)}
              className="ml-auto rounded-full p-0.5 hover:bg-[var(--msg-primary,var(--primary))]/20"
              aria-label={t("voice.removeAttachment")}
            >
              <XIcon className="h-3 w-3" />
            </button>
          </div>
        ) : null}

        {/* Phase 4a — pending video chip. Mirrors the audio chip but
            shows duration + filename. The actual player renders once
            the message lands and the reactive query updates. */}
        {pendingVideo ? (
          <div className="mb-2 flex items-center gap-2 rounded-full border border-[var(--msg-primary,var(--primary))]/30 bg-[var(--msg-primary,var(--primary))]/10 px-3 py-1.5 text-xs font-medium text-[var(--msg-primary,var(--primary))]">
            <VideoIcon className="h-3.5 w-3.5" />
            <span className="truncate max-w-[200px]">
              {pendingVideo.durationMs != null
                ? `Video · ${Math.floor(pendingVideo.durationMs / 60000)}:${String(
                    Math.floor((pendingVideo.durationMs % 60000) / 1000),
                  ).padStart(2, "0")}`
                : `Video · ${pendingVideo.fileName}`}
            </span>
            <button
              type="button"
              onClick={() => setPendingVideo(null)}
              className="ml-auto rounded-full p-0.5 hover:bg-[var(--msg-primary,var(--primary))]/20"
              aria-label="Remove video"
            >
              <XIcon className="h-3 w-3" />
            </button>
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                // Phase 4a: allow Enter-to-send when only a video is
                // attached (empty body but pendingVideo is set).
                if (
                  (body.trim() || pendingVideo) &&
                  !pending &&
                  !videoUploading &&
                  canReplyInApp
                ) {
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
            className="flex-1 resize-none rounded-full border border-[var(--msg-bubble-border,var(--border))] bg-[var(--msg-card,var(--background))] px-4 py-2.5 text-sm text-[var(--msg-text,var(--foreground))] outline-none placeholder:text-[var(--msg-text-muted,var(--muted-foreground))] focus:border-[var(--msg-primary,var(--primary))] focus:ring-2 focus:ring-[var(--msg-primary,var(--primary))]/20 disabled:cursor-not-allowed disabled:opacity-60"
          />
          {voiceMessagesEnabled ? (
            <VoiceRecordButton
              disabled={pending || !canReplyInApp}
              languageHint={myLocale}
              size={compact ? "sm" : "md"}
              onTranscript={(text, retainedAudio) => {
                // Append the transcript so a user who already started typing
                // doesn't lose their draft. Trim so we don't prepend leading
                // whitespace when appending to an empty composer.
                setBody((prev) => (prev ? `${prev} ${text}`.trim() : text));
                // When the admin has audio-retention ON, hold the blob
                // metadata so it ships with the next send() call.
                setPendingAudio(retainedAudio);
              }}
              onError={(message) => showToast(message, "error")}
            />
          ) : null}
          {/* Phase 4a — Video attach button. Hidden on WhatsApp lane
              (sendWhatsAppReply doesn't support attachments) and gated
              by the master flag (env + admin runtime toggle). */}
          {videoEnabled && !isWhatsAppLane ? (
            <label
              className={`flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--msg-bubble-border,var(--border))] text-[var(--msg-text-muted,var(--muted-foreground))] hover:bg-[var(--msg-card,var(--accent))] hover:text-[var(--msg-text,var(--foreground))] ${
                pending || videoUploading || !canReplyInApp || pendingVideo
                  ? "pointer-events-none opacity-40"
                  : ""
              }`}
              aria-label="Attach video"
              title="Attach video"
            >
              {videoUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <VideoIcon className="h-4 w-4" />
              )}
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                className="hidden"
                disabled={
                  pending || videoUploading || !canReplyInApp || !!pendingVideo
                }
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  // Reset the input so the same file can be re-selected
                  // after an error / removal.
                  event.target.value = "";
                  if (!file) return;

                  if (file.size > COMPOSER_MAX_VIDEO_BYTES) {
                    showToast(
                      `Video too large. Max ${Math.round(
                        COMPOSER_MAX_VIDEO_BYTES / (1024 * 1024),
                      )} MB.`,
                      "error",
                    );
                    return;
                  }

                  setVideoUploading(true);
                  try {
                    // Probe metadata first so we can reject overlong
                    // clips before burning bandwidth on upload.
                    const meta = await probeLocalVideo(file);
                    if (
                      meta.durationMs != null &&
                      meta.durationMs > COMPOSER_MAX_VIDEO_SECONDS * 1000
                    ) {
                      showToast(
                        `Video too long. Max ${COMPOSER_MAX_VIDEO_SECONDS}s.`,
                        "error",
                      );
                      return;
                    }

                    // Standard Convex two-step: get a one-shot URL, PUT
                    // the file, then read the storageId from the response.
                    const uploadUrl = await generateUploadUrl({});
                    const putRes = await fetch(uploadUrl, {
                      method: "POST",
                      headers: { "Content-Type": file.type || "video/mp4" },
                      body: file,
                    });
                    if (!putRes.ok) {
                      throw new Error(`Upload failed (${putRes.status}).`);
                    }
                    const { storageId } = (await putRes.json()) as {
                      storageId: string;
                    };

                    setPendingVideo({
                      storageId,
                      mimeType: file.type || "video/mp4",
                      byteSize: file.size,
                      fileName: file.name || `video-${Date.now()}.mp4`,
                      durationMs: meta.durationMs,
                      width: meta.width,
                      height: meta.height,
                    });
                  } catch (error) {
                    showToast(
                      getErrorMessage(error, "Failed to upload video."),
                      "error",
                    );
                  } finally {
                    setVideoUploading(false);
                  }
                }}
              />
            </label>
          ) : null}
          <button
            type="submit"
            disabled={
              pending ||
              (!body.trim() && !pendingVideo) ||
              videoUploading ||
              !canReplyInApp
            }
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--msg-primary,var(--primary))] text-[var(--msg-on-primary,var(--primary-foreground))] shadow-[var(--msg-shadow-float,none)] transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
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
