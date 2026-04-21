// Thin Gemini 2.0 Flash wrapper used by translation actions.
//
// Free tier: 15 requests/minute, 1M tokens/day (per project). Plenty for
// pilot volume — see Docs/cleaner-rollout-and-saas/2026-04-21-bilingual-
// content-translation-plan.md.
//
// Pure helper — no Convex bindings — so it can be unit tested or swapped
// for DeepL/LibreTranslate later without touching call sites.

export type TranslateLocale = "en" | "es";

const LANG_LABEL: Record<TranslateLocale, string> = {
  en: "English",
  es: "Spanish",
};

// Matches the model used in src/app/api/chat/route.ts (admin OpsBot).
// Override via GEMINI_TRANSLATION_MODEL env var if you want to test others.
const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

export class TranslationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "TranslationError";
  }
}

/**
 * Translate `text` from `sourceLang` to `targetLang`. Returns the translated
 * string. Throws TranslationError on API failure — callers decide whether to
 * fall back to the source.
 */
export async function translateText(
  text: string,
  sourceLang: TranslateLocale,
  targetLang: TranslateLocale,
): Promise<string> {
  if (sourceLang === targetLang) return text;
  const trimmed = text.trim();
  if (!trimmed) return "";

  // Same env var the rest of the app uses (admin chat route via @ai-sdk/google).
  // Keep GEMINI_API_KEY as a fallback so either name works.
  const apiKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new TranslationError(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set on the Convex deployment. Run `npx convex env set GOOGLE_GENERATIVE_AI_API_KEY <key>`.",
    );
  }

  const prompt = [
    `Translate the following text from ${LANG_LABEL[sourceLang]} to ${LANG_LABEL[targetLang]}.`,
    "Preserve line breaks, lists, and numeric values exactly.",
    "Keep proper nouns (property names, brand names) untranslated.",
    "Return ONLY the translation — no preamble, no quotes, no commentary.",
    "",
    "TEXT:",
    text,
  ].join("\n");

  const model = process.env.GEMINI_TRANSLATION_MODEL ?? DEFAULT_MODEL;
  const url = `${GEMINI_BASE}${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // Low temperature for deterministic translations
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
      }),
    });
  } catch (error) {
    throw new TranslationError("Network error calling Gemini.", error);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "<no body>");
    throw new TranslationError(
      `Gemini returned ${response.status}: ${detail.slice(0, 300)}`,
    );
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };

  if (payload.promptFeedback?.blockReason) {
    throw new TranslationError(
      `Gemini blocked the prompt: ${payload.promptFeedback.blockReason}`,
    );
  }

  const candidate = payload.candidates?.[0];
  const out = candidate?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!out) {
    throw new TranslationError(
      `Gemini returned no text. finishReason=${candidate?.finishReason ?? "unknown"}`,
    );
  }
  return out;
}

/**
 * Translate a {title, body} pair in a single API call (saves a round-trip).
 * Uses a delimiter the model is reliable at preserving.
 */
export async function translateTitleBody(
  source: { title: string; body: string },
  sourceLang: TranslateLocale,
  targetLang: TranslateLocale,
): Promise<{ title: string; body: string }> {
  if (sourceLang === targetLang) return source;

  const SEP = "\n<<<--- BODY --->>>\n";
  const combined = `${source.title}${SEP}${source.body}`;
  const translated = await translateText(combined, sourceLang, targetLang);

  const parts = translated.split(SEP);
  if (parts.length === 2) {
    return { title: parts[0].trim(), body: parts[1].trim() };
  }
  // Fallback: model dropped the separator — translate them individually.
  const [title, body] = await Promise.all([
    translateText(source.title, sourceLang, targetLang),
    translateText(source.body, sourceLang, targetLang),
  ]);
  return { title, body };
}
