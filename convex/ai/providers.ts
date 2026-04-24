/**
 * AI Provider Registry — voice transcription
 *
 * Thin dispatch layer that maps a `providerKey` (stored in the
 * `aiProviderSettings` table) to a concrete transcription implementation.
 *
 * Adding a new provider:
 *  1. Add the literal to `providerKey` in `convex/schema.ts`.
 *  2. Add the matching entry to `VOICE_PROVIDERS` below.
 *  3. Add the label + cost copy for the admin UI in `convex/ai/settings.ts`.
 *
 * This file runs inside Convex actions (V8 runtime), so `fetch` and standard
 * Web APIs are available. No `"use node"` directive is needed.
 *
 * NOTE ON API SURFACES:
 *   The exact request/response shapes for Gemini / Groq / OpenAI drift often.
 *   The request bodies below were written against Jan-2026 docs but MUST be
 *   verified against the live docs before merging:
 *     - Gemini:  https://ai.google.dev/gemini-api/docs/audio
 *     - Groq:    https://console.groq.com/docs/speech-text
 *     - OpenAI:  https://platform.openai.com/docs/api-reference/audio
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The set of keys that are valid for the voice-transcription feature.
 * MUST stay in lock-step with the `providerKey` literal union in
 * `convex/schema.ts` → `aiProviderSettings`.
 */
export type VoiceProviderKey =
  | "gemini-flash-free"
  | "gemini-flash-paid"
  | "groq-whisper-turbo"
  | "openai-whisper";

export const VOICE_PROVIDER_KEYS: ReadonlyArray<VoiceProviderKey> = [
  "gemini-flash-free",
  "gemini-flash-paid",
  "groq-whisper-turbo",
  "openai-whisper",
] as const;

/** Default provider used on first deploy and whenever no setting row exists. */
export const DEFAULT_VOICE_PROVIDER: VoiceProviderKey = "gemini-flash-free";

export type LanguageHint = "en" | "es";

export interface TranscribeInput {
  /** Raw audio bytes as a Blob (from Convex storage). */
  audio: Blob;
  /** Optional UI locale to bias detection. */
  languageHint?: LanguageHint;
}

export interface TranscribeOutput {
  /** The transcribed text (trimmed). */
  text: string;
  /** BCP-47-ish language code. We normalize to "en" | "es" | other. */
  detectedLang: string;
}

export interface VoiceProvider {
  key: VoiceProviderKey;
  /** Name of the env var that must be set for this provider to work. */
  envVar: string;
  transcribe: (input: TranscribeInput) => Promise<TranscribeOutput>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var "${name}". ` +
        `Set it in the Convex dashboard before selecting this provider.`
    );
  }
  return value;
}

/**
 * Convert a Blob to a base64 string. Used for providers that accept inline
 * audio in the request body (Gemini).
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Chunked conversion to avoid stack overflow on larger clips.
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK))
    );
  }
  // btoa is available in the Convex V8 runtime.
  return btoa(binary);
}

function normalizeLang(raw: unknown): string {
  if (typeof raw !== "string") return "en";
  const lower = raw.toLowerCase().trim();
  if (lower.startsWith("es")) return "es";
  if (lower.startsWith("en")) return "en";
  return lower.slice(0, 5) || "en";
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini (free + paid share the same endpoint — they differ by API key)
// ─────────────────────────────────────────────────────────────────────────────

async function transcribeWithGemini(
  input: TranscribeInput,
  apiKey: string
): Promise<TranscribeOutput> {
  const base64 = await blobToBase64(input.audio);
  const mimeType = input.audio.type || "audio/webm";

  const hintLine = input.languageHint
    ? `The speaker's UI language is "${input.languageHint}", use that as a tiebreaker.`
    : "";

  const prompt =
    `Transcribe the audio verbatim. Detect whether the speaker is using "en" ` +
    `(English) or "es" (Spanish). ${hintLine} ` +
    `Return ONLY valid JSON matching this shape: ` +
    `{"text": string, "language": "en" | "es"}.`;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "<no body>");
    throw new Error(`Gemini transcription failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  let parsed: { text?: unknown; language?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini returned non-JSON response: ${raw.slice(0, 200)}`);
  }

  const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
  return { text, detectedLang: normalizeLang(parsed.language) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Groq (OpenAI-compatible transcriptions endpoint)
// ─────────────────────────────────────────────────────────────────────────────

async function transcribeWithGroq(
  input: TranscribeInput,
  apiKey: string
): Promise<TranscribeOutput> {
  const form = new FormData();
  form.append("file", input.audio, "clip.webm");
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  if (input.languageHint) form.append("language", input.languageHint);

  const res = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "<no body>");
    throw new Error(`Groq transcription failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as { text?: string; language?: string };
  return {
    text: (json.text ?? "").trim(),
    detectedLang: normalizeLang(json.language ?? input.languageHint),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Whisper
// ─────────────────────────────────────────────────────────────────────────────

async function transcribeWithOpenAI(
  input: TranscribeInput,
  apiKey: string
): Promise<TranscribeOutput> {
  const form = new FormData();
  form.append("file", input.audio, "clip.webm");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  if (input.languageHint) form.append("language", input.languageHint);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "<no body>");
    throw new Error(`OpenAI transcription failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as { text?: string; language?: string };
  return {
    text: (json.text ?? "").trim(),
    detectedLang: normalizeLang(json.language ?? input.languageHint),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared env var name used by the existing AI ops assistant. The Voice Free
 * provider reads from this directly; Voice Paid prefers its own key but
 * transparently falls back to this one so "Paid" remains a selectable option
 * out-of-the-box even before a dedicated billed key is provisioned.
 */
const GEMINI_FREE_ENV = "GOOGLE_GENERATIVE_AI_API_KEY";
const GEMINI_PAID_ENV = "GOOGLE_GENERATIVE_AI_API_KEY_PAID";

function resolveGeminiPaidKey(): string {
  // Prefer the explicit paid key; fall back to the shared key. Either works
  // at the API level — the tier distinction is set by Google Cloud billing
  // on whichever key is used.
  return (
    process.env[GEMINI_PAID_ENV] ||
    process.env[GEMINI_FREE_ENV] ||
    ""
  );
}

export const VOICE_PROVIDERS: Record<VoiceProviderKey, VoiceProvider> = {
  "gemini-flash-free": {
    key: "gemini-flash-free",
    envVar: GEMINI_FREE_ENV,
    transcribe: (input) =>
      transcribeWithGemini(input, requireEnv(GEMINI_FREE_ENV)),
  },
  "gemini-flash-paid": {
    key: "gemini-flash-paid",
    // Reported env var is the dedicated paid key — that's what admins should
    // set when they want a separate billed key. The implementation below
    // falls back to the free key so selection doesn't hard-fail.
    envVar: GEMINI_PAID_ENV,
    transcribe: async (input) => {
      const paidKey = process.env[GEMINI_PAID_ENV];
      const freeKey = process.env[GEMINI_FREE_ENV];

      // If there's no dedicated paid key, transparently behave as "free".
      if (!paidKey) {
        if (!freeKey) {
          throw new Error(
            `Missing Gemini API key. Set "${GEMINI_PAID_ENV}" or ` +
              `"${GEMINI_FREE_ENV}" in the Convex dashboard.`
          );
        }
        return transcribeWithGemini(input, freeKey);
      }

      // Try the paid key first. If it fails with a cap / quota / billing
      // error — very likely on a $1-capped experimentation key — retry with
      // the free key so the user still gets their transcript.
      try {
        return await transcribeWithGemini(input, paidKey);
      } catch (err) {
        if (!freeKey) throw err;
        const msg = String(err instanceof Error ? err.message : err);
        const isCapError =
          msg.includes(" 402 ") || // payment required
          msg.includes(" 429 ") || // rate / quota exhausted
          /quota|billing|exceeded|limit/i.test(msg);
        if (!isCapError) throw err;
        console.warn(
          `[voice] Gemini paid key failed (${msg.slice(0, 120)}); ` +
            `falling back to free key.`
        );
        return transcribeWithGemini(input, freeKey);
      }
    },
  },
  "groq-whisper-turbo": {
    key: "groq-whisper-turbo",
    envVar: "GROQ_API_KEY",
    transcribe: (input) =>
      transcribeWithGroq(input, requireEnv("GROQ_API_KEY")),
  },
  "openai-whisper": {
    key: "openai-whisper",
    envVar: "OPENAI_API_KEY",
    transcribe: (input) =>
      transcribeWithOpenAI(input, requireEnv("OPENAI_API_KEY")),
  },
};

/**
 * Look up a provider implementation by key. Throws if the key is not
 * registered (should be impossible given the schema literal union, but we
 * double-check at runtime to fail loudly on drift).
 */
export function getVoiceProvider(key: VoiceProviderKey): VoiceProvider {
  const provider = VOICE_PROVIDERS[key];
  if (!provider) {
    throw new Error(
      `Unknown voice provider key "${key}". Expected one of: ${VOICE_PROVIDER_KEYS.join(", ")}`
    );
  }
  return provider;
}

/**
 * Whether the env var(s) backing a provider are present. Used by the admin
 * UI to show which options are actually usable and by the settings mutation
 * to reject selection of an unconfigured provider.
 *
 * Special case: `gemini-flash-paid` reports configured when *either* the
 * dedicated paid key OR the shared free key is set, matching the fallback
 * behaviour inside its `transcribe` implementation.
 */
export function isVoiceProviderConfigured(key: VoiceProviderKey): boolean {
  if (key === "gemini-flash-paid") {
    return Boolean(
      process.env[GEMINI_PAID_ENV] || process.env[GEMINI_FREE_ENV]
    );
  }
  return Boolean(process.env[VOICE_PROVIDERS[key].envVar]);
}
