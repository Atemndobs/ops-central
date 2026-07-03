//
// Gemini-backed guest-review reply drafter. Mirrors convex/lib/messageEnhance.ts
// in shape: pure helper, no Convex bindings, same env vars, same error-class
// pattern. Callers (convex/guestReviews/actions.ts) decide what to do on
// failure — the review row simply stays in "needs_draft" and is retried by
// the next daily sync pass.

const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

export class ReviewResponseDraftError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ReviewResponseDraftError";
    this.cause = cause;
  }
}

export interface DraftReviewResponseInput {
  rating: number;
  publicReview: string;
  guestFirstName: string;
  propertyName: string;
}

export async function draftReviewResponse(
  input: DraftReviewResponseInput,
): Promise<string> {
  const apiKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ReviewResponseDraftError(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set on the Convex deployment.",
    );
  }

  const tone =
    input.rating >= 4
      ? "warm and appreciative"
      : "measured, non-defensive, and appreciative of the feedback without making excuses";

  const prompt = [
    "You are drafting a short public reply to a guest review of a short-term",
    `rental property called "${input.propertyName}" on Airbnb. The reply will`,
    "be posted publicly and visible to future guests.",
    "",
    `Guest: ${input.guestFirstName || "the guest"}`,
    `Star rating: ${input.rating} out of 5`,
    `Review text: "${input.publicReview}"`,
    "",
    "Write a reply that:",
    `- Is ${tone} in tone.`,
    "- Thanks the guest by first name (if given) and references something",
    "  specific from their review — never generic filler.",
    "- Never offers a discount, refund, or any specific promised fix with a date.",
    "- Never uses legal or liability language.",
    "- Is 2 to 4 sentences long.",
    "",
    "Return ONLY the reply text — no preamble, no quotes, no commentary.",
  ].join("\n");

  const model = process.env.GEMINI_REVIEW_REPLY_MODEL ?? DEFAULT_MODEL;
  const url = `${GEMINI_BASE}${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 512 },
      }),
    });
  } catch (error) {
    throw new ReviewResponseDraftError("Network error calling Gemini.", error);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "<no body>");
    throw new ReviewResponseDraftError(
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
    throw new ReviewResponseDraftError(
      `Gemini blocked the prompt: ${payload.promptFeedback.blockReason}`,
    );
  }

  const candidate = payload.candidates?.[0];
  const out = candidate?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!out) {
    throw new ReviewResponseDraftError(
      `Gemini returned no text. finishReason=${candidate?.finishReason ?? "unknown"}`,
    );
  }
  return out;
}
