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

import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { Loader2, Mic, Send, Video as VideoIcon, X as XIcon } from "lucide-react";
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
  onSubmit: () => Promise<void>;
};

export function ChatComposer({
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
