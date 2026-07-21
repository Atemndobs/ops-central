//
// Gemini-backed guest-review reply drafter. Mirrors convex/lib/messageEnhance.ts
// in shape: pure helper, no Convex bindings, same env vars, same error-class
// pattern. Callers (convex/guestReviews/actions.ts) decide what to do on
// failure — the review row simply stays in "needs_draft" and is retried by
// the next daily sync pass.

export type ReviewProvider = "gemini" | "claude" | "openai";

export interface RefineReviewResponseInput {
  rating: number;
  publicReview: string;
  privateFeedback?: string;
  guestFirstName: string;
  guestLastName: string;
  propertyName: string;
  stayCheckIn?: number;
  stayCheckOut?: number;
  totalAmount?: number;
  currency?: string;
  currentDraft: string;
  instruction?: string;
  provider: ReviewProvider;
  systemPromptOverride?: string;
}

export interface RefineOutreachMessageInput {
  guestName: string;
  propertyName: string;
  stayCheckIn: number;
  stayCheckOut: number;
  currentDraft: string;
  provider: ReviewProvider;
  incentive: "none" | "return_discount" | "google_review" | "early_late_checkin";
  tone: string;
  length: string;
  instruction?: string;
}

const DEFAULT_REVIEW_SYSTEM_PROMPT = `You are a hospitality operations manager drafting public replies to guest reviews for ChezSoi Stays, a premium short-term rental company. Your replies appear publicly on Airbnb and are visible to future guests. Always:
- Thank the guest by first name and reference something specific from their review
- Be warm and appreciative for positive reviews; measured, non-defensive, and professional for complaints
- Acknowledge issues without admitting fault or making specific fix promises with dates
- Never offer discounts, refunds, or use legal/liability language
- Keep replies to 2–4 sentences maximum
- Show that management cares and acts on feedback`;

function buildRefinePrompt(input: RefineReviewResponseInput): string {
  const fmt = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const stayLine =
    input.stayCheckIn && input.stayCheckOut
      ? `Stay: ${fmt(input.stayCheckIn)} – ${fmt(input.stayCheckOut)}${input.totalAmount ? ` · ${input.currency ?? "USD"} ${input.totalAmount.toFixed(2)} total` : ""}`
      : null;

  return [
    `Property: ${input.propertyName}`,
    `Guest: ${[input.guestFirstName, input.guestLastName].filter(Boolean).join(" ")}`,
    `Rating: ${input.rating}/5 stars`,
    stayLine,
    `Review: "${input.publicReview}"`,
    input.privateFeedback ? `Private guest feedback: "${input.privateFeedback}"` : null,
    "",
    "Current draft reply:",
    `"${input.currentDraft}"`,
    "",
    input.instruction
      ? `Refinement instruction: ${input.instruction}`
      : "Improve this draft — make it more specific, natural, and professional while keeping the same intent.",
    "",
    "Return ONLY the improved reply text — no preamble, no quotes, no commentary.",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

async function callGeminiRefine(system: string, user: string): Promise<string> {
  const apiKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ReviewResponseDraftError("GEMINI_API_KEY not set.");
  const model = process.env.GEMINI_REVIEW_REPLY_MODEL ?? DEFAULT_MODEL;
  const url = `${GEMINI_BASE}${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 512 },
    }),
  });
  if (!res.ok) throw new ReviewResponseDraftError(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const payload = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const out = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!out) throw new ReviewResponseDraftError("Gemini returned no text.");
  return out;
}

async function callClaudeRefine(system: string, user: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ReviewResponseDraftError("ANTHROPIC_API_KEY not set in Convex environment.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_REVIEW_REPLY_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new ReviewResponseDraftError(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const payload = await res.json() as { content?: Array<{ text?: string }> };
  const out = payload.content?.map((c) => c.text ?? "").join("").trim();
  if (!out) throw new ReviewResponseDraftError("Claude returned no text.");
  return out;
}

async function callOpenAIRefine(system: string, user: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ReviewResponseDraftError("OPENAI_API_KEY not set in Convex environment.");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_REVIEW_REPLY_MODEL ?? "gpt-4o-mini",
      max_tokens: 512,
      temperature: 0.6,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new ReviewResponseDraftError(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const payload = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const out = payload.choices?.[0]?.message?.content?.trim();
  if (!out) throw new ReviewResponseDraftError("OpenAI returned no text.");
  return out;
}

export async function refineReviewResponse(input: RefineReviewResponseInput): Promise<string> {
  const system = input.systemPromptOverride ?? DEFAULT_REVIEW_SYSTEM_PROMPT;
  const user = buildRefinePrompt(input);
  switch (input.provider) {
    case "gemini": return callGeminiRefine(system, user);
    case "claude": return callClaudeRefine(system, user);
    case "openai": return callOpenAIRefine(system, user);
  }
}

const OUTREACH_SYSTEM_PROMPT = `You are a hospitality operations manager drafting a private post-stay message for ChezSoi Stays. The guest has checked out but has not left a review yet. Always:
- Thank the guest and invite them to stay again
- Ask politely for an honest review without pressuring or implying a required positive rating
- Preserve any incentive selected by the manager, but never invent offers
- Never claim the guest said something they did not say
- Return only the guest-ready message, with no preamble or commentary`;

export async function refineOutreachMessage(
  input: RefineOutreachMessageInput,
): Promise<string> {
  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const incentiveInstruction: Record<RefineOutreachMessageInput["incentive"], string> = {
    none: "Do not offer an incentive.",
    return_discount: "Keep or add the approved 10% discount on the guest's next stay.",
    google_review: "Ask for a Google review without offering compensation for it.",
    early_late_checkin: "Offer an early check-in or late check-out on a future stay, subject to availability.",
  };
  const lengthInstruction =
    input.length === "short"
      ? "Use 2 to 3 sentences."
      : input.length === "detailed"
        ? "Use 5 or more sentences."
        : "Use 3 to 5 sentences.";
  const userPrompt = [
    `Guest: ${input.guestName || "Guest"}`,
    `Property: ${input.propertyName}`,
    `Stay: ${formatDate(input.stayCheckIn)} – ${formatDate(input.stayCheckOut)}`,
    `Tone: ${input.tone}.`,
    lengthInstruction,
    incentiveInstruction[input.incentive],
    "",
    "Current outreach draft:",
    input.currentDraft,
    "",
    input.instruction
      ? `Additional manager instruction: ${input.instruction}`
      : "Improve the draft while preserving its intent and accurate details.",
    "",
    "Return ONLY the improved outreach message.",
  ].join("\n");

  switch (input.provider) {
    case "gemini":
      return callGeminiRefine(OUTREACH_SYSTEM_PROMPT, userPrompt);
    case "claude":
      return callClaudeRefine(OUTREACH_SYSTEM_PROMPT, userPrompt);
    case "openai":
      return callOpenAIRefine(OUTREACH_SYSTEM_PROMPT, userPrompt);
  }
}

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
