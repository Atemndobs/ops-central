// Gemini-backed "polish this draft" helper for the messages composer.
//
// Mirrors convex/lib/translation.ts in shape so the same env var, model
// override, and error class semantics work for both. Pure helper — no
// Convex bindings — so it can be unit tested or swapped for another
// provider later.

export type EnhanceLocale = "en" | "es";

const LANG_LABEL: Record<EnhanceLocale, string> = {
  en: "English",
  es: "Spanish",
};

const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

export class MessageEnhanceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "MessageEnhanceError";
  }
}

/**
 * Polish a draft message: fix typos, tighten phrasing, keep the user's
 * voice. Returns the rewritten text in the SAME language as the input
 * (no translation). Throws MessageEnhanceError on API failure — callers
 * decide whether to surface a toast and keep the original draft.
 */
export async function enhanceMessageDraft(
  text: string,
  locale: EnhanceLocale,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const apiKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new MessageEnhanceError(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set on the Convex deployment.",
    );
  }

  const prompt = [
    `You are an editor for short operational chat messages between property`,
    `managers and cleaning staff. The draft below is in ${LANG_LABEL[locale]}.`,
    "",
    "Rewrite the draft to:",
    "- Fix typos, grammar, and capitalization.",
    "- Keep it warm, direct, and professional — no fluff, no apologies.",
    "- Preserve the original meaning, intent, and any specific values",
    "  (times, addresses, names, numbers).",
    "- Keep it roughly the same length. Never expand a one-liner into a paragraph.",
    `- Output in the SAME language (${LANG_LABEL[locale]}). Do NOT translate.`,
    "",
    "Return ONLY the rewritten message — no preamble, no quotes, no commentary.",
    "",
    "DRAFT:",
    text,
  ].join("\n");

  const model = process.env.GEMINI_ENHANCE_MODEL ?? DEFAULT_MODEL;
  const url = `${GEMINI_BASE}${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
      }),
    });
  } catch (error) {
    throw new MessageEnhanceError("Network error calling Gemini.", error);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "<no body>");
    throw new MessageEnhanceError(
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
    throw new MessageEnhanceError(
      `Gemini blocked the prompt: ${payload.promptFeedback.blockReason}`,
    );
  }

  const candidate = payload.candidates?.[0];
  const out = candidate?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!out) {
    throw new MessageEnhanceError(
      `Gemini returned no text. finishReason=${candidate?.finishReason ?? "unknown"}`,
    );
  }
  return out;
}
