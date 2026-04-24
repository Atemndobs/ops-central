"use client";

/**
 * useVoiceRecorder — record short audio clips and transcribe via Convex.
 *
 * Flow:
 *   1. start()        → getUserMedia + MediaRecorder begins capturing.
 *   2. stop()         → MediaRecorder flushes, blob is assembled.
 *   3.                → client requests a Convex upload URL, PUTs the blob.
 *   4.                → client invokes the transcribe action with the storageId.
 *   5.                → transcript lands on the hook's state; caller reads it.
 *
 *   cancel() at any time discards the recording and aborts the pipeline.
 *
 * Design notes:
 *   - Uses MediaRecorder with opus/webm by default. Falls back to whatever
 *     the browser picks when those MIME types aren't supported.
 *   - Hard-caps recordings at 60s. At 55s the hook emits a `nearLimit` flag
 *     so the UI can show a countdown; at 60s it auto-stops.
 *   - All cleanup (stream tracks, timers, promise chains) runs in one
 *     `cleanup()` helper that's safe to call multiple times.
 *   - The hook never renders audio back to the user in v1 — transcript only.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export type VoiceRecorderState =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "uploading"
  | "transcribing"
  | "ready"
  | "error";

export type VoiceRecorderError =
  | "permission-denied"
  | "not-supported"
  | "no-device"
  | "upload-failed"
  | "transcription-failed"
  | "aborted"
  | "unknown";

export interface UseVoiceRecorderOptions {
  /** Max clip length in seconds. Hard-stops at this value. Default 60. */
  maxDurationSec?: number;
  /** Show countdown warning this many seconds before the max. Default 10. */
  warnThresholdSec?: number;
  /** Optional UI locale hint passed to the transcription provider. */
  languageHint?: "en" | "es";
}

export interface UseVoiceRecorderReturn {
  state: VoiceRecorderState;
  /** Seconds elapsed in the current recording. 0 when idle. */
  elapsedSec: number;
  /** True within warnThresholdSec of the max duration. */
  nearLimit: boolean;
  /** Transcript of the most recent successful recording. Empty otherwise. */
  transcript: string;
  /** Detected language from the last transcription. */
  detectedLang: string | null;
  /** Error code from the most recent failure, if any. */
  error: VoiceRecorderError | null;
  /** Free-form error message for debugging / toasts. */
  errorMessage: string | null;

  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  /** Clear the current transcript so the UI goes back to idle. */
  reset: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_SEC = 60;
const DEFAULT_WARN_SEC = 10;

function pickMimeType(): string | undefined {
  // MediaRecorder throws if you pass an unsupported MIME. Try the best
  // compression-to-support ratio first, then progressively fall back.
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4", // Safari
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return undefined;
}

export function useVoiceRecorder(
  options: UseVoiceRecorderOptions = {}
): UseVoiceRecorderReturn {
  const maxSec = options.maxDurationSec ?? DEFAULT_MAX_SEC;
  const warnSec = options.warnThresholdSec ?? DEFAULT_WARN_SEC;
  const languageHint = options.languageHint;

  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [error, setError] = useState<VoiceRecorderError | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const generateUploadUrl = useMutation(
    api.conversations.voice.generateVoiceUploadUrl
  );
  const transcribeAction = useAction(api.conversations.voice.transcribe);

  // Refs for things that must survive re-renders but never trigger them.
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<boolean>(false);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  // Cleanup on unmount so we don't leak mic streams.
  useEffect(() => cleanup, [cleanup]);

  const fail = useCallback(
    (code: VoiceRecorderError, message: string) => {
      cleanup();
      setError(code);
      setErrorMessage(message);
      setState("error");
      setElapsedSec(0);
    },
    [cleanup]
  );

  const reset = useCallback(() => {
    cleanup();
    setState("idle");
    setElapsedSec(0);
    setTranscript("");
    setDetectedLang(null);
    setError(null);
    setErrorMessage(null);
    abortRef.current = false;
  }, [cleanup]);

  const cancel = useCallback(() => {
    abortRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore — we're tearing down anyway
      }
    }
    cleanup();
    setState("idle");
    setElapsedSec(0);
  }, [cleanup]);

  const start = useCallback(async () => {
    if (state === "recording" || state === "uploading" || state === "transcribing") {
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      fail("not-supported", "Your browser does not support microphone access.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      fail("not-supported", "Your browser does not support audio recording.");
      return;
    }

    setError(null);
    setErrorMessage(null);
    setTranscript("");
    setDetectedLang(null);
    abortRef.current = false;
    setState("requesting-permission");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown permission error";
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        fail(
          "permission-denied",
          "Microphone access was denied. Enable it in your browser settings."
        );
      } else if (err instanceof DOMException && err.name === "NotFoundError") {
        fail("no-device", "No microphone was found on this device.");
      } else {
        fail("unknown", message);
      }
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (err) {
      fail(
        "not-supported",
        err instanceof Error ? err.message : "MediaRecorder not available"
      );
      return;
    }
    recorderRef.current = recorder;

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    });

    recorder.addEventListener("stop", async () => {
      if (abortRef.current) {
        cleanup();
        return;
      }

      const chunks = chunksRef.current;
      const effectiveMime = mimeType || recorder.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type: effectiveMime });

      // Release the mic stream now — we don't need it during upload/transcribe.
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (autoStopRef.current) {
        clearTimeout(autoStopRef.current);
        autoStopRef.current = null;
      }

      // Sanity: if no audio was actually captured, bail with a clear error.
      if (blob.size === 0) {
        fail("unknown", "No audio was captured. Try again.");
        return;
      }

      // ── Upload ────────────────────────────────────────────────────────
      setState("uploading");
      let storageId: string;
      try {
        const uploadUrl = await generateUploadUrl();
        const uploadRes = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": effectiveMime },
          body: blob,
        });
        if (!uploadRes.ok) {
          throw new Error(`Upload failed: ${uploadRes.status}`);
        }
        const uploadJson = (await uploadRes.json()) as { storageId: string };
        storageId = uploadJson.storageId;
      } catch (err) {
        if (abortRef.current) return;
        fail(
          "upload-failed",
          err instanceof Error ? err.message : "Upload failed"
        );
        return;
      }

      if (abortRef.current) return;

      // ── Transcribe ────────────────────────────────────────────────────
      setState("transcribing");
      try {
        const result = await transcribeAction({
          // Cast: action validator is v.id("_storage") which TypeScript sees
          // as a branded Id; the JSON from Convex upload is a plain string
          // that the server re-validates. Safe under this contract.
          storageId: storageId as unknown as Parameters<
            typeof transcribeAction
          >[0]["storageId"],
          languageHint,
        });
        if (abortRef.current) return;
        setTranscript(result.text);
        setDetectedLang(result.detectedLang);
        setState("ready");
      } catch (err) {
        if (abortRef.current) return;
        fail(
          "transcription-failed",
          err instanceof Error ? err.message : "Transcription failed"
        );
      }
    });

    recorder.addEventListener("error", () => {
      fail("unknown", "Recorder error — stopping.");
    });

    // ── Kick off the recording ──────────────────────────────────────────
    try {
      recorder.start();
    } catch (err) {
      fail(
        "unknown",
        err instanceof Error ? err.message : "Could not start recorder"
      );
      return;
    }

    startedAtRef.current = Date.now();
    setElapsedSec(0);
    setState("recording");

    timerRef.current = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsedSec(seconds);
    }, 250);

    autoStopRef.current = setTimeout(() => {
      if (recorderRef.current && recorderRef.current.state === "recording") {
        try {
          recorderRef.current.stop();
        } catch {
          // ignore
        }
      }
    }, maxSec * 1000);
  }, [
    state,
    fail,
    cleanup,
    generateUploadUrl,
    transcribeAction,
    languageHint,
    maxSec,
  ]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore
      }
    }
  }, []);

  const nearLimit = state === "recording" && elapsedSec >= maxSec - warnSec;

  return {
    state,
    elapsedSec,
    nearLimit,
    transcript,
    detectedLang,
    error,
    errorMessage,
    start,
    stop,
    cancel,
    reset,
  };
}
