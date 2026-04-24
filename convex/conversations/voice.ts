/**
 * Voice messaging — transcription pipeline
 *
 * Client flow (see `src/hooks/use-voice-recorder.ts`):
 *   1. Client records audio via MediaRecorder.
 *   2. Client calls `generateVoiceUploadUrl` → gets a signed Convex upload URL.
 *   3. Client PUTs the audio Blob to that URL → receives a `storageId`.
 *   4. Client calls `transcribe` with the storageId → returns `{ text, detectedLang }`.
 *   5. Client populates the composer textarea and the user reviews & sends.
 *
 * The audio blob is deleted from Convex storage immediately after successful
 * transcription. No raw audio is retained in v1 (by design — see PLAN.md §10).
 *
 * Provider selection is driven by the admin setting in `aiProviderSettings`.
 * The action is a thin router; all provider-specific code lives in
 * `convex/ai/providers.ts`.
 */

import { v } from "convex/values";
import { action, mutation } from "../_generated/server";
import { api } from "../_generated/api";
import { getCurrentUser } from "../lib/auth";
import {
  getVoiceProvider,
  type TranscribeOutput,
  type VoiceProviderKey,
} from "../ai/providers";

// ─────────────────────────────────────────────────────────────────────────────
// Upload URL — client uploads the recorded audio blob here before transcribing.
// Gated to authenticated users so we don't hand out free upload URLs.
// ─────────────────────────────────────────────────────────────────────────────

export const generateVoiceUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await getCurrentUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Transcribe — V8 action. Fetches audio, delegates to the selected provider,
// returns the transcript. Cleans up the blob on success AND on failure so
// we never leak storage.
// ─────────────────────────────────────────────────────────────────────────────

export const transcribe = action({
  args: {
    storageId: v.id("_storage"),
    languageHint: v.optional(v.union(v.literal("en"), v.literal("es"))),
  },
  returns: v.object({
    text: v.string(),
    detectedLang: v.string(),
    providerKey: v.union(
      v.literal("gemini-flash"),
      v.literal("groq-whisper-turbo"),
      v.literal("openai-whisper")
    ),
  }),
  handler: async (ctx, args) => {
    // Auth — identity only, no db lookup needed here since the upload URL
    // was already gated and the mutation-level audit trail isn't useful
    // for ephemeral transcription calls.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated. Please sign in to use voice messages.");
    }

    // Resolve which provider to use. Separate runQuery call keeps the
    // transactional boundaries clean (the setting could change during a
    // long transcription, but we pin it at the start of this call).
    const setting: {
      providerKey: VoiceProviderKey;
      updatedAt: number | undefined;
      isDefault: boolean;
    } = await ctx.runQuery(api.ai.settings.getVoiceProvider, {});

    // Fetch the audio blob that the client just uploaded.
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) {
      throw new Error(
        "Audio file not found in storage. The upload may have failed or the " +
          "clip was already consumed by a previous transcription attempt."
      );
    }

    // Rough guard: ~60s of Opus-encoded audio is well under 1 MB. Anything
    // above 5 MB is almost certainly a client bug or abuse.
    const MAX_BYTES = 5 * 1024 * 1024;
    if (blob.size > MAX_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new Error(
        `Audio clip too large (${blob.size} bytes). Maximum is ${MAX_BYTES} bytes.`
      );
    }

    const provider = getVoiceProvider(setting.providerKey);

    let result: TranscribeOutput;
    try {
      result = await provider.transcribe({
        audio: blob,
        languageHint: args.languageHint,
      });
    } finally {
      // Always clean up — success OR failure. Transcripts are the product;
      // raw audio has no value beyond this action. A storage leak here
      // would silently balloon our bill.
      try {
        await ctx.storage.delete(args.storageId);
      } catch {
        // Swallow — if delete fails we'd rather the caller see the real
        // transcription error (if any) than a secondary cleanup error.
      }
    }

    return {
      text: result.text,
      detectedLang: result.detectedLang,
      providerKey: setting.providerKey,
    };
  },
});
