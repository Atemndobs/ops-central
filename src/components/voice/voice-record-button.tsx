"use client";

/**
 * VoiceRecordButton — drop-in mic button for the messages composer.
 *
 * Renders a single button whose appearance cycles through the recorder
 * states. Tap starts; tap again stops. While recording, an inline row
 * appears above the composer showing elapsed time, a pulsing indicator,
 * a cancel (X) button, and a near-limit countdown.
 *
 * The button reports the final transcript up to the parent via
 * `onTranscript`; the parent decides whether to replace or append to the
 * composer text. After reporting, the hook is reset to idle so a second
 * recording can begin immediately.
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Mic, Square, X } from "lucide-react";
import {
  useVoiceRecorder,
  type RetainedAudio,
  type VoiceRecorderError,
} from "@/hooks/use-voice-recorder";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface VoiceRecordButtonProps {
  /**
   * Called when recording + transcription succeed. The parent is responsible
   * for inserting the text into the composer state.
   *
   * The second argument `retainedAudio` is populated only when the admin has
   * enabled the `voice_audio_attachments` feature flag; when present, the
   * parent should forward it to `sendMessage` so the audio is attached to
   * the posted message as a playable bubble.
   */
  onTranscript: (text: string, retainedAudio: RetainedAudio | null) => void;

  /**
   * Called with a human-readable error message when something fails
   * (permission denied, network, quota, etc.). Parent typically shows a toast.
   */
  onError?: (message: string, code: VoiceRecorderError) => void;

  /** Disable the button entirely (e.g. while the composer is sending). */
  disabled?: boolean;

  /** UI locale hint forwarded to the transcription provider. */
  languageHint?: "en" | "es";

  /** Max recording duration in seconds. Default 60. */
  maxDurationSec?: number;

  /**
   * Size variant. "md" matches the default 40×40 composer button; "sm"
   * matches compact toolbars.
   */
  size?: "sm" | "md";

  /** Optional extra class names for the root button. */
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function VoiceRecordButton({
  onTranscript,
  onError,
  disabled = false,
  languageHint,
  maxDurationSec = 60,
  size = "md",
  className = "",
}: VoiceRecordButtonProps) {
  const t = useTranslations();
  const recorder = useVoiceRecorder({ languageHint, maxDurationSec });

  // ── Report results up to the parent, then reset so we're ready for
  //    another recording without leaving stale state behind.
  useEffect(() => {
    if (recorder.state === "ready" && recorder.transcript) {
      onTranscript(recorder.transcript, recorder.retainedAudio);
      recorder.reset();
    }
  }, [
    recorder.state,
    recorder.transcript,
    recorder.retainedAudio,
    recorder,
    onTranscript,
  ]);

  useEffect(() => {
    if (recorder.state === "error" && recorder.error) {
      onError?.(
        recorder.errorMessage ?? t("voice.errors.generic"),
        recorder.error
      );
      recorder.reset();
    }
  }, [recorder.state, recorder.error, recorder.errorMessage, recorder, onError, t]);

  const dimensions =
    size === "sm"
      ? "h-8 w-8"
      : "h-10 w-10";
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  const isBusy =
    recorder.state === "requesting-permission" ||
    recorder.state === "uploading" ||
    recorder.state === "transcribing";
  const isRecording = recorder.state === "recording";

  const ariaLabel = isRecording
    ? t("voice.stop")
    : isBusy
      ? recorder.state === "uploading"
        ? t("voice.uploading")
        : recorder.state === "transcribing"
          ? t("voice.transcribing")
          : t("voice.requestingPermission")
      : t("voice.startRecording");

  const handleClick = () => {
    if (isRecording) {
      recorder.stop();
      return;
    }
    if (isBusy) return;
    void recorder.start();
  };

  // ── Colour / icon per state. Recording = red pulse, busy = spinner,
  //    idle = neutral mic that inherits the surrounding palette.
  const buttonStyles = isRecording
    ? "bg-red-500/15 text-red-500 ring-2 ring-red-500/50 animate-pulse"
    : isBusy
      ? "bg-[var(--msg-card,var(--muted))] text-[var(--msg-text-muted,var(--muted-foreground))]"
      : "bg-[var(--msg-card,var(--muted))] text-[var(--msg-text,var(--foreground))] hover:bg-[var(--msg-card-hover,var(--accent))]";

  return (
    <div className="relative flex items-center gap-1">
      {isRecording ? (
        <div
          className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-500"
          role="timer"
          aria-live="polite"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
          <span className="font-mono tabular-nums">
            {formatElapsed(recorder.elapsedSec)}
          </span>
          {recorder.nearLimit && (
            <span className="text-red-600">
              {t("voice.nearLimit", {
                remaining: Math.max(0, maxDurationSec - recorder.elapsedSec),
              })}
            </span>
          )}
          <button
            type="button"
            onClick={recorder.cancel}
            className="ml-0.5 rounded-full p-0.5 hover:bg-red-500/20"
            aria-label={t("voice.cancel")}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isBusy}
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-pressed={isRecording}
        className={`flex shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${dimensions} ${buttonStyles} ${className}`}
      >
        {isBusy ? (
          <Loader2 className={`${iconSize} animate-spin`} />
        ) : isRecording ? (
          <Square className={iconSize} fill="currentColor" />
        ) : (
          <Mic className={iconSize} />
        )}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
