import { test } from "node:test";
import assert from "node:assert/strict";
import { draftReviewResponse, ReviewResponseDraftError } from "./reviewResponseDraft.ts";

function mockFetchOnce(response: { ok: boolean; status?: number; json?: unknown; text?: string }) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.json,
    text: async () => response.text ?? "",
  })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const INPUT = {
  rating: 5,
  publicReview: "Loved the location and the check-in was seamless.",
  guestFirstName: "Jane",
  propertyName: "The Paris",
};

test("draftReviewResponse: throws when API key is missing", async () => {
  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const prevAlt = process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(() => draftReviewResponse(INPUT), ReviewResponseDraftError);
  } finally {
    if (prevKey !== undefined) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;
    if (prevAlt !== undefined) process.env.GEMINI_API_KEY = prevAlt;
  }
});

test("draftReviewResponse: returns the trimmed reply text on success", async () => {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  const restore = mockFetchOnce({
    ok: true,
    json: {
      candidates: [
        { content: { parts: [{ text: "  Thanks so much, Jane! So glad you loved it.  " }] } },
      ],
    },
  });
  try {
    const result = await draftReviewResponse(INPUT);
    assert.equal(result, "Thanks so much, Jane! So glad you loved it.");
  } finally {
    restore();
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  }
});

test("draftReviewResponse: throws ReviewResponseDraftError on non-ok response", async () => {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  const restore = mockFetchOnce({ ok: false, status: 429, text: "rate limited" });
  try {
    await assert.rejects(() => draftReviewResponse(INPUT), ReviewResponseDraftError);
  } finally {
    restore();
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  }
});

test("draftReviewResponse: throws ReviewResponseDraftError when blocked by safety filter", async () => {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  const restore = mockFetchOnce({ ok: true, json: { promptFeedback: { blockReason: "SAFETY" } } });
  try {
    await assert.rejects(() => draftReviewResponse(INPUT), ReviewResponseDraftError);
  } finally {
    restore();
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  }
});
