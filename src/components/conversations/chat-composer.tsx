"use client";

/**
 * ChatComposer — extracted from conversation-thread.tsx (Phase A of the
 * Granola-inspired composer redesign). This is a pure extraction: same
 * markup, same handlers, same behaviour as the inline form it replaces.
 *
 * Phase B will introduce the Granola pill shape behind the
 * `messages_granola_composer` feature flag. The flag check stays in the
 * parent (`conversation-thread.tsx`) so the parent can render either
 * shape without the composer needing to know.
 *
 * See Docs/messages-redesign/2026-04-28-granola-inspired-chat-input.md.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import {
  Camera,
  FileUp,
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Send,
  Video as VideoIcon,
  X as XIcon,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";
import { VoiceRecordButton } from "@/components/voice/voice-record-button";

type MessageLocale = "en" | "es";

export type PendingAudio = {
  storageId: string;
  mimeType: string;
  byteSize: number;
  durationMs: number;
};

export type PendingVideo = {
  storageId: string;
  mimeType: string;
  byteSize: number;
  fileName: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

/** Hard cap surfaced to the user. Stays in sync with mediaValidation
 *  ceilings on the backend (60 s / 25 MiB per ADR-0003). */
const COMPOSER_MAX_VIDEO_SECONDS = 60;
const COMPOSER_MAX_VIDEO_BYTES = 25 * 1024 * 1024;

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

export type ChatComposerProps = {
  body: string;
  setBody: (next: string | ((prev: string) => string)) => void;
  pending: boolean;
  setPending: (pending: boolean) => void;
  pendingAudio: PendingAudio | null;
  setPendingAudio: (audio: PendingAudio | null) => void;
  pendingVideo: PendingVideo | null;
  setPendingVideo: (video: PendingVideo | null) => void;
  videoUploading: boolean;
  setVideoUploading: (uploading: boolean) => void;
  isWhatsAppLane: boolean;
  canReplyInApp: boolean;
  compact: boolean;
  myLocale: MessageLocale;
  voiceMessagesEnabled: boolean | undefined;
  videoEnabled: boolean;
  /** Phase B — render the Granola pill shape when true. Default false
   *  preserves the legacy side-by-side layout. */
  granolaShape?: boolean;
  onSubmit: () => Promise<void>;
};

export function ChatComposer(props: ChatComposerProps) {
  if (props.granolaShape) {
    return <GranolaChatComposer {...props} />;
  }
  return <LegacyChatComposer {...props} />;
}

function LegacyChatComposer({
  body,
  setBody,
  pending,
  pendingAudio,
  setPendingAudio,
  pendingVideo,
  setPendingVideo,
  videoUploading,
  setVideoUploading,
  isWhatsAppLane,
  canReplyInApp,
  compact,
  myLocale,
  voiceMessagesEnabled,
  videoEnabled,
  onSubmit,
}: ChatComposerProps) {
  const t = useTranslations();
  const { showToast } = useToast();
  const generateUploadUrl = useMutation(api.files.mutations.generateUploadUrl);

  return (
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
        await onSubmit();
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
                    storageId: Id<"_storage">;
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
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Granola variant — Phase B
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared video-upload pipeline used by both the legacy Video button and
 * the Granola attach popover. Same Convex two-step (`generateUploadUrl`
 * → PUT) and same client-side caps as the legacy path. Keeps Phase B
 * free of behaviour drift on the upload side.
 */
function useVideoUploader(args: {
  setVideoUploading: (v: boolean) => void;
  setPendingVideo: (v: PendingVideo | null) => void;
}) {
  const { setVideoUploading, setPendingVideo } = args;
  const generateUploadUrl = useMutation(api.files.mutations.generateUploadUrl);
  const { showToast } = useToast();

  return async (file: File) => {
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
        storageId: Id<"_storage">;
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
      showToast(getErrorMessage(error, "Failed to upload video."), "error");
    } finally {
      setVideoUploading(false);
    }
  };
}

function GranolaChatComposer({
  body,
  setBody,
  pending,
  pendingAudio,
  setPendingAudio,
  pendingVideo,
  setPendingVideo,
  videoUploading,
  setVideoUploading,
  isWhatsAppLane,
  canReplyInApp,
  compact,
  myLocale,
  voiceMessagesEnabled,
  videoEnabled,
  onSubmit,
}: ChatComposerProps) {
  const t = useTranslations();
  const { showToast } = useToast();
  const uploadVideo = useVideoUploader({ setVideoUploading, setPendingVideo });

  // Attach popover open state. Closes on outside click / Escape.
  const [attachOpen, setAttachOpen] = useState(false);
  const attachRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!attachOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (
        attachRef.current &&
        !attachRef.current.contains(event.target as Node)
      ) {
        setAttachOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAttachOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [attachOpen]);

  const hasContent = body.trim().length > 0 || !!pendingVideo;
  const showSendSlot = hasContent || pendingAudio != null;
  const sendDisabled =
    pending ||
    (!body.trim() && !pendingVideo) ||
    videoUploading ||
    !canReplyInApp;
  const inputDisabled = pending || !canReplyInApp;

  return (
    <form
      className="shrink-0 border-t border-[var(--msg-divider,var(--border))] p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!body.trim() && !pendingVideo) return;
        await onSubmit();
      }}
      onDragOver={(event) => {
        if (!videoEnabled || isWhatsAppLane) return;
        event.preventDefault();
      }}
      onDrop={async (event) => {
        if (!videoEnabled || isWhatsAppLane) return;
        const file = event.dataTransfer.files?.[0];
        if (!file || !file.type.startsWith("video/")) return;
        event.preventDefault();
        await uploadVideo(file);
      }}
      onPaste={async (event) => {
        if (!videoEnabled || isWhatsAppLane) return;
        const item = Array.from(event.clipboardData.items).find((i) =>
          i.type.startsWith("video/"),
        );
        if (!item) return;
        const file = item.getAsFile();
        if (!file) return;
        event.preventDefault();
        await uploadVideo(file);
      }}
    >
      {pendingAudio ? (
        <div className="mb-2 flex items-center gap-2 rounded-full border border-[var(--msg-primary,var(--primary))]/30 bg-[var(--msg-primary,var(--primary))]/10 px-3 py-1.5 text-xs font-medium text-[var(--msg-primary,var(--primary))]">
          <Mic className="h-3.5 w-3.5" />
          <span>
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

      {/* Granola pill tile: textarea is the visual anchor; trailing
          action cluster (attach + mic↔send) sits inside the right edge. */}
      <div className="rounded-2xl border border-[var(--msg-bubble-border,var(--border))] bg-[var(--msg-card,var(--background))] p-2 transition-colors focus-within:border-[var(--msg-primary,var(--primary))] focus-within:ring-2 focus-within:ring-[var(--msg-primary,var(--primary))]/20">
        <div className="flex items-end gap-1.5">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              // Granola keyboard contract: Enter = newline, Cmd/Ctrl+Enter = send.
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
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
            disabled={inputDisabled}
            placeholder={
              isWhatsAppLane
                ? canReplyInApp
                  ? "Reply in WhatsApp…"
                  : "Await cleaner reply…"
                : "Type a message…"
            }
            className="min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-[var(--msg-text,var(--foreground))] outline-none placeholder:text-[var(--msg-text-muted,var(--muted-foreground))] disabled:cursor-not-allowed disabled:opacity-60"
          />

          {/* Attach popover (paperclip) — unified entry for image / file / camera / video. */}
          <div className="relative" ref={attachRef}>
            <button
              type="button"
              disabled={pending || !canReplyInApp}
              onClick={() => setAttachOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={attachOpen}
              aria-label="Attach"
              title="Attach"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--msg-text-muted,var(--muted-foreground))] transition-colors hover:bg-[var(--msg-card,var(--accent))] hover:text-[var(--msg-text,var(--foreground))] disabled:opacity-40"
            >
              {videoUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </button>
            {attachOpen ? (
              <div
                role="menu"
                className="absolute bottom-12 right-0 z-20 w-52 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--popover,var(--card))] shadow-lg"
              >
                {/* Photo / file attach are wired in a follow-up phase
                    (the existing photo upload pipeline lives outside the
                    conversation composer today). Disabled rows show the
                    intended affordances without claiming functionality. */}
                <AttachOption
                  icon={<Camera className="h-4 w-4" />}
                  label="Take photo"
                  disabled
                  onPick={() => setAttachOpen(false)}
                />
                <AttachOption
                  icon={<ImageIcon className="h-4 w-4" />}
                  label="Choose photo"
                  disabled
                  onPick={() => setAttachOpen(false)}
                />
                <AttachOption
                  icon={<FileUp className="h-4 w-4" />}
                  label="Choose file"
                  disabled
                  onPick={() => setAttachOpen(false)}
                />
                {videoEnabled && !isWhatsAppLane ? (
                  <AttachOption
                    icon={<VideoIcon className="h-4 w-4" />}
                    label="Record video"
                    accept="video/mp4,video/webm,video/quicktime"
                    capture="environment"
                    disabled={
                      pending ||
                      videoUploading ||
                      !canReplyInApp ||
                      !!pendingVideo
                    }
                    onPick={async (file) => {
                      setAttachOpen(false);
                      if (file) await uploadVideo(file);
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Mic ↔ send — single right-most slot. Mic when input empty &
              voice flag on; send when there is content. */}
          {showSendSlot ? (
            <button
              type="submit"
              disabled={sendDisabled}
              aria-label="Send message"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--msg-primary,var(--primary))] text-[var(--msg-on-primary,var(--primary-foreground))] shadow-[var(--msg-shadow-float,none)] transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          ) : voiceMessagesEnabled ? (
            <VoiceRecordButton
              disabled={pending || !canReplyInApp}
              languageHint={myLocale}
              size="sm"
              onTranscript={(text, retainedAudio) => {
                setBody((prev) => (prev ? `${prev} ${text}`.trim() : text));
                setPendingAudio(retainedAudio);
              }}
              onError={(message) => showToast(message, "error")}
            />
          ) : (
            // Voice off + empty input → show disabled send so the slot
            // never collapses and shifts the layout while typing.
            <button
              type="submit"
              disabled
              aria-label="Send message"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--msg-primary,var(--primary))] text-[var(--msg-on-primary,var(--primary-foreground))] opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function AttachOption({
  icon,
  label,
  accept,
  capture,
  multiple,
  disabled,
  onPick,
}: {
  icon: React.ReactNode;
  label: string;
  accept?: string;
  capture?: "user" | "environment";
  multiple?: boolean;
  disabled?: boolean;
  onPick: (file: File | null) => void | Promise<void>;
}) {
  return (
    <label
      role="menuitem"
      className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] ${
        disabled ? "pointer-events-none opacity-40" : ""
      }`}
    >
      {icon}
      <span>{label}</span>
      <input
        type="file"
        accept={accept}
        capture={capture}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = "";
          void onPick(file);
        }}
      />
    </label>
  );
}
