# AI Review-Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an AI-drafted, human-approved guest-review reply workflow that ingests Airbnb reviews from Hospitable, drafts a reply with Gemini, and — once an admin or property_ops user approves it — publishes it back to Airbnb via Hospitable's respond-to-review API.

**Architecture:** Reuses the existing Hospitable webhook (`convex/hospitable/webhooks.ts`) + daily-cron backstop pattern for ingestion, a new `guestReviews` Convex table with a `needs_draft → drafted → sending → sent` state machine, a pure Gemini-REST helper mirroring `convex/lib/messageEnhance.ts` for drafting, and two UI surfaces (a top-level inbox + a property-detail section) gated behind a new `reviewsAiReply` feature flag (default OFF).

**Tech Stack:** Convex (schema/queries/mutations/actions/crons), Next.js App Router client components, Gemini REST API, Hospitable Public API v2, Node's built-in test runner (`node --test`).

## Global Constraints

- Every Convex function (`query`/`mutation`/`action`/internal variants) MUST declare an `args` validator — no exceptions (`convex/_generated/ai/guidelines.md`).
- Index names must include every indexed field, e.g. `by_property` for a single-field index on `propertyId` (already followed below — no compound indexes needed here).
- New pure logic (normalization, state-machine transitions, AI prompt construction) must live in files with **zero Convex imports** so `node --test` can import them directly — mirrors `convex/owner/feeEngine.ts`. Thin Convex wrappers (mutations/actions/webhooks) are NOT unit tested in this codebase (no test files exist for `convex/hospitable/mutations.ts` or `webhooks.ts`) — validated instead via `npx convex dev --once` typecheck, `npm run build`, and manual QA once the Hospitable OAuth scope is granted.
- Every new user-facing feature ships behind a feature flag, default OFF (`Docs/feature-flags/PATTERN.md`).
- All work happens in this worktree (`~/sites/opscentral-admin-review-response-ai`, branch `task/review-response-ai`) per `.harness/project-rules.md` — never edit the main `opscentral-admin` checkout, never run `npx convex dev`/`deploy` from here.
- **Blocked external dependency:** the Hospitable OAuth connection does not have `reviews:read`/`reviews:write` scopes granted yet (`Docs/runbooks/hospitable-webhook-token-auth.md:105` explicitly scoped reviews out of Phase 0). Tasks 1–11 (schema, pure logic, ingestion, mutations, actions) are fully buildable and unit-testable without live API access. Tasks 7, 8, and 11's `sendApprovedReply`/`syncGuestReviews` cannot be exercised against real Hospitable data — and the UI in Tasks 12–14 will show an empty inbox — until whoever owns the Hospitable account re-authorizes with both scopes. Flag this blocker to the user before merging; it does not block writing or committing the code.

---

## Task 1: Schema — `guestReviews` table + `reviewsAiReply` feature flag

**Files:**
- Modify: `convex/schema.ts:2116` (insert new table definition near `hospitableWebhookEvents`) and `convex/schema.ts:1481-1503` (add flag literal), `convex/schema.ts:2122` (registration list)
- Modify: `convex/admin/featureFlags.ts` (flag validator, type, metadata)

**Interfaces:**
- Produces: `guestReviews` table with fields `hospitableReviewId, propertyId, platform, rating, publicReview, privateFeedback, guestFirstName, guestLastName, reviewedAt, canRespond, status, aiDraftText, aiDraftGeneratedAt, respondedText, respondedAt, respondedBy, sendError`; indexes `by_hospitable_review_id`, `by_property`, `by_status`. Produces feature flag key `"reviewsAiReply"`.

- [ ] **Step 1: Add the `guestReviews` table definition**

In `convex/schema.ts`, immediately before the `hospitableWebhookEvents` table definition (the block starting `const hospitableWebhookEvents = defineTable({` around line 1317), insert:

```ts
const guestReviews = defineTable({
  hospitableReviewId: v.string(),
  propertyId: v.id("properties"),
  platform: v.union(v.literal("airbnb"), v.literal("direct")),
  rating: v.number(),
  publicReview: v.string(),
  privateFeedback: v.optional(v.string()),
  guestFirstName: v.string(),
  guestLastName: v.string(),
  reviewedAt: v.number(),
  canRespond: v.boolean(),
  status: v.union(
    v.literal("needs_draft"),
    v.literal("drafted"),
    v.literal("sending"),
    v.literal("sent"),
    v.literal("dismissed"),
    v.literal("send_failed"),
  ),
  aiDraftText: v.optional(v.string()),
  aiDraftGeneratedAt: v.optional(v.number()),
  respondedText: v.optional(v.string()),
  respondedAt: v.optional(v.number()),
  respondedBy: v.optional(v.id("users")),
  sendError: v.optional(v.string()),
})
  .index("by_hospitable_review_id", ["hospitableReviewId"])
  .index("by_property", ["propertyId"])
  .index("by_status", ["status"]);
```

- [ ] **Step 2: Register the table in `defineSchema`**

In `convex/schema.ts`, find the registration block around line 2116:

```ts
  // Integration
  hospitableConfig,
  hospitableWebhookEvents,
```

Change to:

```ts
  // Integration
  hospitableConfig,
  hospitableWebhookEvents,
  guestReviews,
```

- [ ] **Step 3: Add the `reviewsAiReply` flag literal to the schema union**

In `convex/schema.ts`, inside the `featureFlags` table's `key` union (around line 1502), change:

```ts
    v.literal("owner_overview_auto_drafts")
    // future flags go here
  ),
```

to:

```ts
    v.literal("owner_overview_auto_drafts"),
    // Guest-review AI reply workflow (inbox + property-detail section).
    // Default OFF — enable for the J&A team once real Hospitable review
    // data is flowing (requires reviews:read/reviews:write OAuth scope).
    v.literal("reviewsAiReply")
    // future flags go here
  ),
```

- [ ] **Step 4: Register the flag in `convex/admin/featureFlags.ts`**

Add `v.literal("reviewsAiReply")` to `flagKeyValidator`'s union (mirroring the schema change), add `"reviewsAiReply"` to the `FeatureFlagKey` string union type, and add to `FLAG_METADATA`:

```ts
  reviewsAiReply: {
    key: "reviewsAiReply",
    label: "AI review-response inbox",
    description:
      "Adds a top-level Reviews inbox and a Reviews section on property " +
      "detail. Guest reviews synced from Hospitable get an AI-drafted " +
      "reply that an admin or property_ops user edits and approves " +
      "before it's published back to Airbnb.",
    offBehaviour:
      "Reviews nav item and property-detail Reviews section are hidden. " +
      "Ingestion and drafting still run in the background regardless of " +
      "this flag — it only gates the UI.",
  },
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: no new type errors related to `guestReviews` or `reviewsAiReply`.

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/admin/featureFlags.ts
git commit -m "feat(reviews): add guestReviews table and reviewsAiReply feature flag"
```

---

## Task 2: Pure normalize helper — `convex/guestReviews/normalize.ts`

**Files:**
- Create: `convex/guestReviews/normalize.ts`
- Test: `convex/guestReviews/normalize.test.ts`

**Interfaces:**
- Produces: `NormalizedGuestReview` interface and `normalizeGuestReview(raw: unknown): { review: NormalizedGuestReview | null; error?: string }`. Consumed by Task 6 (webhook) and Task 7 (daily sync).

- [ ] **Step 1: Write the failing test**

```ts
// convex/guestReviews/normalize.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGuestReview } from "./normalize.ts";

const VALID_RAW = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  platform: "airbnb",
  public: { rating: 5, review: "Great place we will be back!" },
  private: { feedback: "downstairs was a bit cold." },
  reviewed_at: "2024-03-19T10:00:00Z",
  can_respond: true,
  guest: { first_name: "Jane", last_name: "Doe" },
  property: { id: "497f6eca-6276-4993-bfeb-53cbbbba6f08", name: "The Paris" },
};

test("normalizeGuestReview: maps a valid Airbnb review", () => {
  const { review, error } = normalizeGuestReview(VALID_RAW);
  assert.equal(error, undefined);
  assert.ok(review);
  assert.equal(review.hospitableReviewId, VALID_RAW.id);
  assert.equal(review.hospitablePropertyId, VALID_RAW.property.id);
  assert.equal(review.platform, "airbnb");
  assert.equal(review.rating, 5);
  assert.equal(review.publicReview, "Great place we will be back!");
  assert.equal(review.privateFeedback, "downstairs was a bit cold.");
  assert.equal(review.guestFirstName, "Jane");
  assert.equal(review.guestLastName, "Doe");
  assert.equal(review.reviewedAt, Date.parse("2024-03-19T10:00:00Z"));
  assert.equal(review.canRespond, true);
});

test("normalizeGuestReview: defaults missing guest name and private feedback", () => {
  const raw = {
    ...VALID_RAW,
    private: {},
    guest: {},
  };
  const { review, error } = normalizeGuestReview(raw);
  assert.equal(error, undefined);
  assert.ok(review);
  assert.equal(review.guestFirstName, "");
  assert.equal(review.guestLastName, "");
  assert.equal(review.privateFeedback, undefined);
});

test("normalizeGuestReview: rejects a non-object payload", () => {
  const { review, error } = normalizeGuestReview("not an object");
  assert.equal(review, null);
  assert.match(error ?? "", /not an object/i);
});

test("normalizeGuestReview: rejects missing required fields", () => {
  const { review, error } = normalizeGuestReview({ id: "abc" });
  assert.equal(review, null);
  assert.match(error ?? "", /missing/i);
});

test("normalizeGuestReview: rejects an unrecognized platform", () => {
  const raw = { ...VALID_RAW, platform: "booking_com" };
  const { review, error } = normalizeGuestReview(raw);
  assert.equal(review, null);
  assert.match(error ?? "", /platform/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test convex/guestReviews/normalize.test.ts`
Expected: FAIL — `Cannot find module './normalize.ts'` (or similar), since the file doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// convex/guestReviews/normalize.ts
//
// Pure normalizer for Hospitable's Review resource — same shape whether it
// arrives via the `review.created` webhook payload or the
// GET /v2/properties/{uuid}/reviews list endpoint (both return the
// documented `Review` object: id, platform, public{rating,review},
// private{feedback}, reviewed_at, can_respond, guest{first_name,last_name},
// property{id,...}). Zero Convex imports so this is directly unit-testable.

export interface NormalizedGuestReview {
  hospitableReviewId: string;
  hospitablePropertyId: string;
  platform: "airbnb" | "direct";
  rating: number;
  publicReview: string;
  privateFeedback?: string;
  guestFirstName: string;
  guestLastName: string;
  reviewedAt: number;
  canRespond: boolean;
}

type GenericRecord = Record<string, unknown>;

function isRecord(value: unknown): value is GenericRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const VALID_PLATFORMS = new Set(["airbnb", "direct"]);

export function normalizeGuestReview(
  raw: unknown,
): { review: NormalizedGuestReview | null; error?: string } {
  if (!isRecord(raw)) {
    return { review: null, error: "Review payload is not an object." };
  }

  const hospitableReviewId = asString(raw.id);
  const platform = asString(raw.platform);
  const publicBlock = isRecord(raw.public) ? raw.public : undefined;
  const rating = asNumber(publicBlock?.rating);
  const publicReview = asString(publicBlock?.review);
  const reviewedAtRaw = asString(raw.reviewed_at);
  const property = isRecord(raw.property) ? raw.property : undefined;
  const hospitablePropertyId = asString(property?.id);

  if (
    !hospitableReviewId ||
    !platform ||
    rating === undefined ||
    !publicReview ||
    !reviewedAtRaw ||
    !hospitablePropertyId
  ) {
    return {
      review: null,
      error:
        "Review payload missing one of: id, platform, public.rating, " +
        "public.review, reviewed_at, property.id.",
    };
  }

  if (!VALID_PLATFORMS.has(platform)) {
    return {
      review: null,
      error: `Unrecognized review platform "${platform}" — expected airbnb or direct.`,
    };
  }

  const reviewedAt = Date.parse(reviewedAtRaw);
  if (Number.isNaN(reviewedAt)) {
    return { review: null, error: `Unparseable reviewed_at: "${reviewedAtRaw}".` };
  }

  const privateBlock = isRecord(raw.private) ? raw.private : undefined;
  const guest = isRecord(raw.guest) ? raw.guest : undefined;

  return {
    review: {
      hospitableReviewId,
      hospitablePropertyId,
      platform: platform as "airbnb" | "direct",
      rating,
      publicReview,
      privateFeedback: asString(privateBlock?.feedback),
      guestFirstName: asString(guest?.first_name) ?? "",
      guestLastName: asString(guest?.last_name) ?? "",
      reviewedAt,
      canRespond: raw.can_respond === true,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test convex/guestReviews/normalize.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add convex/guestReviews/normalize.ts convex/guestReviews/normalize.test.ts
git commit -m "feat(reviews): add pure Hospitable review normalizer"
```

---

## Task 3: Pure status-machine helper — `convex/guestReviews/statusMachine.ts`

**Files:**
- Create: `convex/guestReviews/statusMachine.ts`
- Test: `convex/guestReviews/statusMachine.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `GuestReviewStatus` type, `canTransition(from: GuestReviewStatus, to: GuestReviewStatus): boolean`, `assertTransition(from: GuestReviewStatus, to: GuestReviewStatus): void` (throws `InvalidReviewTransitionError` on an illegal transition). Consumed by Task 10 (`convex/guestReviews/mutations.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// convex/guestReviews/statusMachine.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  assertTransition,
  InvalidReviewTransitionError,
} from "./statusMachine.ts";

test("canTransition: needs_draft -> drafted is allowed", () => {
  assert.equal(canTransition("needs_draft", "drafted"), true);
});

test("canTransition: drafted -> sending is allowed", () => {
  assert.equal(canTransition("drafted", "sending"), true);
});

test("canTransition: sending -> sent is allowed", () => {
  assert.equal(canTransition("sending", "sent"), true);
});

test("canTransition: sending -> send_failed is allowed", () => {
  assert.equal(canTransition("sending", "send_failed"), true);
});

test("canTransition: send_failed -> sending is allowed (retry)", () => {
  assert.equal(canTransition("send_failed", "sending"), true);
});

test("canTransition: needs_draft -> dismissed is allowed", () => {
  assert.equal(canTransition("needs_draft", "dismissed"), true);
});

test("canTransition: drafted -> dismissed is allowed", () => {
  assert.equal(canTransition("drafted", "dismissed"), true);
});

test("canTransition: sent -> anything is never allowed (terminal)", () => {
  assert.equal(canTransition("sent", "drafted"), false);
  assert.equal(canTransition("sent", "sending"), false);
  assert.equal(canTransition("sent", "dismissed"), false);
});

test("canTransition: dismissed -> anything is never allowed (terminal)", () => {
  assert.equal(canTransition("dismissed", "drafted"), false);
});

test("canTransition: needs_draft -> sending is not allowed (must draft first)", () => {
  assert.equal(canTransition("needs_draft", "sending"), false);
});

test("assertTransition: throws InvalidReviewTransitionError on illegal transition", () => {
  assert.throws(
    () => assertTransition("sent", "drafted"),
    InvalidReviewTransitionError,
  );
});

test("assertTransition: does not throw on a legal transition", () => {
  assert.doesNotThrow(() => assertTransition("drafted", "sending"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test convex/guestReviews/statusMachine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// convex/guestReviews/statusMachine.ts
//
// Pure state machine for guestReviews.status. Zero Convex imports.
//
//   needs_draft --(AI draft)--> drafted --(approve)--> sending --(API ok)--> sent
//        |                         |                       |
//        +---(dismiss)--> dismissed                        +--(API error)--> send_failed --(retry)--> sending

export type GuestReviewStatus =
  | "needs_draft"
  | "drafted"
  | "sending"
  | "sent"
  | "dismissed"
  | "send_failed";

const ALLOWED_TRANSITIONS: Record<GuestReviewStatus, GuestReviewStatus[]> = {
  needs_draft: ["drafted", "dismissed"],
  drafted: ["sending", "dismissed"],
  sending: ["sent", "send_failed"],
  send_failed: ["sending"],
  sent: [],
  dismissed: [],
};

export class InvalidReviewTransitionError extends Error {
  constructor(
    public readonly from: GuestReviewStatus,
    public readonly to: GuestReviewStatus,
  ) {
    super(`Cannot transition guestReviews.status from "${from}" to "${to}".`);
    this.name = "InvalidReviewTransitionError";
  }
}

export function canTransition(from: GuestReviewStatus, to: GuestReviewStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: GuestReviewStatus, to: GuestReviewStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidReviewTransitionError(from, to);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test convex/guestReviews/statusMachine.test.ts`
Expected: PASS, all 12 tests green.

- [ ] **Step 5: Commit**

```bash
git add convex/guestReviews/statusMachine.ts convex/guestReviews/statusMachine.test.ts
git commit -m "feat(reviews): add pure guest-review status state machine"
```

---

## Task 4: Pure AI draft helper — `convex/lib/reviewResponseDraft.ts`

**Files:**
- Create: `convex/lib/reviewResponseDraft.ts`
- Test: `convex/lib/reviewResponseDraft.test.ts`

**Interfaces:**
- Produces: `ReviewResponseDraftError` class, `draftReviewResponse(input: { rating: number; publicReview: string; guestFirstName: string; propertyName: string }): Promise<string>`. Consumed by Task 11 (`convex/guestReviews/actions.ts::generateDraft`).

- [ ] **Step 1: Write the failing test**

Mirrors `messageEnhance.ts`'s untested-in-practice shape, but per Global Constraints we hold new pure modules to the TDD bar — mock `globalThis.fetch`.

```ts
// convex/lib/reviewResponseDraft.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test convex/lib/reviewResponseDraft.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// convex/lib/reviewResponseDraft.ts
//
// Gemini-backed guest-review reply drafter. Mirrors convex/lib/messageEnhance.ts
// in shape: pure helper, no Convex bindings, same env vars, same error-class
// pattern. Callers (convex/guestReviews/actions.ts) decide what to do on
// failure — the review row simply stays in "needs_draft" and is retried by
// the next daily sync pass.

const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

export class ReviewResponseDraftError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ReviewResponseDraftError";
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test convex/lib/reviewResponseDraft.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/reviewResponseDraft.ts convex/lib/reviewResponseDraft.test.ts
git commit -m "feat(reviews): add Gemini review-reply drafting helper"
```

---

## Task 5: Ingestion mutation — `upsertGuestReview`

**Files:**
- Modify: `convex/hospitable/mutations.ts`

**Interfaces:**
- Consumes: `NormalizedGuestReview` (Task 2), `internal.guestReviews.actions.generateDraft` (Task 11 — forward reference; scheduling call is added now, the target function is created in Task 11, so this task's build will fail to typecheck until Task 11 lands. Do Tasks in order and typecheck at the end of Task 11, not here.)
- Produces: `upsertGuestReview` internal mutation, importable as `internal.hospitable.mutations.upsertGuestReview`.

- [ ] **Step 1: Add the mutation**

In `convex/hospitable/mutations.ts`, add near the top (after existing imports):

```ts
import { internal } from "../_generated/api";
```

Then append at the end of the file:

```ts
/**
 * Idempotent upsert of a single normalized guest review, called from both
 * the `review.created` webhook branch (convex/hospitable/webhooks.ts) and
 * the daily backstop sync (convex/hospitable/actions.ts::syncGuestReviews).
 *
 * Only review FACTS (rating, text, canRespond) are refreshed on repeat
 * delivery — our own workflow `status` (drafted/sent/dismissed/...) is
 * preserved once set, so a re-sync never resets an in-progress or completed
 * reply. On first insert, schedules AI draft generation.
 */
export const upsertGuestReview = internalMutation({
  args: {
    hospitableReviewId: v.string(),
    hospitablePropertyId: v.string(),
    platform: v.union(v.literal("airbnb"), v.literal("direct")),
    rating: v.number(),
    publicReview: v.string(),
    privateFeedback: v.optional(v.string()),
    guestFirstName: v.string(),
    guestLastName: v.string(),
    reviewedAt: v.number(),
    canRespond: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ outcome: "inserted" | "updated" | "skipped_no_property" }> => {
    const property = await ctx.db
      .query("properties")
      .withIndex("by_hospitable", (q) => q.eq("hospitableId", args.hospitablePropertyId))
      .first();

    if (!property) {
      return { outcome: "skipped_no_property" };
    }

    const existing = await ctx.db
      .query("guestReviews")
      .withIndex("by_hospitable_review_id", (q) => q.eq("hospitableReviewId", args.hospitableReviewId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        rating: args.rating,
        publicReview: args.publicReview,
        privateFeedback: args.privateFeedback,
        canRespond: args.canRespond,
      });
      // A row can be stuck in "needs_draft" if a prior generateDraft call
      // failed (e.g. a transient Gemini error) — re-schedule on every
      // re-sync until it succeeds, since the daily backstop is also our
      // only retry mechanism for that failure mode.
      if (existing.status === "needs_draft") {
        await ctx.scheduler.runAfter(0, internal.guestReviews.actions.generateDraft, {
          reviewId: existing._id,
        });
      }
      return { outcome: "updated" };
    }

    const reviewId = await ctx.db.insert("guestReviews", {
      hospitableReviewId: args.hospitableReviewId,
      propertyId: property._id,
      platform: args.platform,
      rating: args.rating,
      publicReview: args.publicReview,
      privateFeedback: args.privateFeedback,
      guestFirstName: args.guestFirstName,
      guestLastName: args.guestLastName,
      reviewedAt: args.reviewedAt,
      canRespond: args.canRespond,
      status: "needs_draft",
    });

    await ctx.scheduler.runAfter(0, internal.guestReviews.actions.generateDraft, { reviewId });

    return { outcome: "inserted" };
  },
});
```

- [ ] **Step 2: Commit**

This task's typecheck depends on Task 11 (`internal.guestReviews.actions.generateDraft` doesn't exist until then). Stage but do not run a standalone typecheck yet:

```bash
git add convex/hospitable/mutations.ts
git commit -m "feat(reviews): add upsertGuestReview ingestion mutation (WIP — depends on Task 11)"
```

---

## Task 6: Webhook wiring — `review.created` branch

**Files:**
- Modify: `convex/hospitable/webhooks.ts`

**Interfaces:**
- Consumes: `normalizeGuestReview` (Task 2), `internal.hospitable.mutations.upsertGuestReview` (Task 5).

- [ ] **Step 1: Add the review-event branch**

In `convex/hospitable/webhooks.ts`, add the import and the new action set near the existing `RESERVATION_EVENT_ACTIONS`:

```ts
import { normalizeGuestReview } from "../guestReviews/normalize";
```

```ts
const REVIEW_EVENT_ACTIONS = new Set(["review.created"]);
```

Then, in `ingestEvent`'s handler, after the existing reservation branch (the block that returns after calling `upsertSingleReservation`) and before the final `return { outcome: RECEIVE_OUTCOME.processed, ... }` fallthrough — insert a new branch. The full handler body's tail becomes:

```ts
    if (RESERVATION_EVENT_ACTIONS.has(args.action)) {
      const rawReservation = (args.rawPayload as { data?: unknown })?.data;
      const { reservation, error } = normalizeReservation(rawReservation, "");

      if (!reservation) {
        await ctx.db.patch(eventDocId, {
          processedAt: Date.now(),
          processingError: error ?? "Failed to normalize reservation payload.",
        });
        return { outcome: RECEIVE_OUTCOME.normalizationFailed, eventDocId };
      }

      try {
        await upsertSingleReservation(ctx, {
          reservation,
          syncedAt: args.receivedAt,
        });
        await ctx.db.patch(eventDocId, { processedAt: Date.now() });
      } catch (err) {
        await ctx.db.patch(eventDocId, {
          processedAt: Date.now(),
          processingError: err instanceof Error ? err.message : String(err),
        });
      }

      return { outcome: RECEIVE_OUTCOME.processed, eventDocId };
    }

    if (REVIEW_EVENT_ACTIONS.has(args.action)) {
      const rawReview = (args.rawPayload as { data?: unknown })?.data;
      const { review, error } = normalizeGuestReview(rawReview);

      if (!review) {
        await ctx.db.patch(eventDocId, {
          processedAt: Date.now(),
          processingError: error ?? "Failed to normalize review payload.",
        });
        return { outcome: RECEIVE_OUTCOME.normalizationFailed, eventDocId };
      }

      try {
        await ctx.runMutation(internal.hospitable.mutations.upsertGuestReview, review);
        await ctx.db.patch(eventDocId, { processedAt: Date.now() });
      } catch (err) {
        await ctx.db.patch(eventDocId, {
          processedAt: Date.now(),
          processingError: err instanceof Error ? err.message : String(err),
        });
      }

      return { outcome: RECEIVE_OUTCOME.processed, eventDocId };
    }

    await ctx.db.patch(eventDocId, { processedAt: Date.now() });
    return { outcome: RECEIVE_OUTCOME.ignoredAction, eventDocId };
```

This replaces the existing `if (!RESERVATION_EVENT_ACTIONS.has(args.action)) { ...ignored... }` + trailing reservation-processing block with the three-way branch above (reservation / review / ignored). Note `ctx.runMutation` requires `internal` — add `import { internal } from "../_generated/api";` to this file's imports alongside the existing ones if not already present (check first: `grep -n "^import" convex/hospitable/webhooks.ts`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: no new errors. (Errors referencing `internal.guestReviews.actions.generateDraft` or `internal.guestReviews.mutations.*` are expected until Tasks 9–11 land — re-run this check after Task 11.)

- [ ] **Step 3: Commit**

```bash
git add convex/hospitable/webhooks.ts
git commit -m "feat(reviews): wire review.created webhook events to guestReviews ingestion"
```

---

## Task 7: Daily backstop sync — `syncGuestReviews` + cron

**Files:**
- Modify: `convex/hospitable/actions.ts`
- Modify: `convex/crons.ts`

**Interfaces:**
- Consumes: `normalizeGuestReview` (Task 2), `internal.hospitable.mutations.upsertGuestReview` (Task 5), private in-file helpers `fetchAllHospitablePages`, `isRecord`.
- Produces: `syncGuestReviews` internal action, importable as `internal.hospitable.actions.syncGuestReviews`.

- [ ] **Step 1: Add the import**

In `convex/hospitable/actions.ts`, add near the top:

```ts
import { normalizeGuestReview } from "../guestReviews/normalize";
```

- [ ] **Step 2: Add the action**

Append to `convex/hospitable/actions.ts`:

```ts
/**
 * Daily backstop sync for guest reviews. The `review.created` webhook
 * (convex/hospitable/webhooks.ts) is the primary ingestion path; this sweep
 * catches deliveries that failed before our ingest mutation ran, and
 * backfills review history the first time this runs against a property.
 * Iterates OUR properties table (not Hospitable's) — only properties with
 * hospitableId set are queryable against the reviews endpoint.
 */
export const syncGuestReviews = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    propertiesScanned: number;
    reviewsUpserted: number;
    reviewsSkipped: number;
    errors: string[];
  }> => {
    const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) {
      throw new Error("Missing HOSPITABLE_API_KEY/HOSPITABLE_API_TOKEN environment variable.");
    }
    const baseUrl = process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL;

    const properties: Array<Doc<"properties">> = await ctx.runQuery(
      internal.hospitable.queries.listPropertiesWithHospitableId,
      {},
    );

    let reviewsUpserted = 0;
    let reviewsSkipped = 0;
    const errors: string[] = [];

    for (const property of properties) {
      if (!property.hospitableId) continue;

      let rawReviews: unknown[];
      try {
        rawReviews = await fetchAllHospitablePages(
          apiKey,
          `${baseUrl}/properties/${property.hospitableId}/reviews`,
          ctx,
          "hospitable_reviews_sync",
        );
      } catch (error) {
        errors.push(
          `Property ${property.hospitableId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      for (const rawReview of rawReviews) {
        const { review, error } = normalizeGuestReview(rawReview);
        if (!review) {
          if (error) errors.push(error);
          reviewsSkipped++;
          continue;
        }

        const result = await ctx.runMutation(internal.hospitable.mutations.upsertGuestReview, review);
        if (result.outcome === "skipped_no_property") {
          reviewsSkipped++;
        } else {
          reviewsUpserted++;
        }
      }
    }

    return {
      propertiesScanned: properties.length,
      reviewsUpserted,
      reviewsSkipped,
      errors,
    };
  },
});
```

- [ ] **Step 3: Add the supporting internal query**

`syncGuestReviews` needs a way to list properties with `hospitableId` set. Create `convex/hospitable/queries.ts`'s addition (this file already exists — append to it):

```ts
export const listPropertiesWithHospitableId = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("properties").collect();
    return all.filter((p) => !!p.hospitableId);
  },
});
```

Add `internalQuery` to that file's existing import from `../_generated/server` if not already imported (check with `grep -n "^import" convex/hospitable/queries.ts` — the file already imports `internalQuery` per earlier inspection showing `listStaysMissingPlatform = internalQuery(...)`, so no import change needed).

- [ ] **Step 4: Register the cron**

In `convex/crons.ts`, add after the `sync-hospitable-property-details-daily` entry:

```ts
// Daily backstop for guest reviews. Primary path is the review.created
// webhook (convex/hospitable/webhooks.ts); reviews are far lower-volume
// and lower-urgency than reservations, so daily (not hourly) is enough.
// See Docs/superpowers/specs/2026-07-03-review-response-ai-design.md.
crons.interval(
  "sync-hospitable-reviews-daily",
  { hours: 24 },
  internal.hospitable.actions.syncGuestReviews,
  {}
);
```

- [ ] **Step 5: Commit**

```bash
git add convex/hospitable/actions.ts convex/hospitable/queries.ts convex/crons.ts
git commit -m "feat(reviews): add daily guest-review backstop sync"
```

---

## Task 8: Hospitable send helper — `postReviewResponse`

**Files:**
- Modify: `convex/hospitable/actions.ts`

**Interfaces:**
- Produces: plain exported async function `postReviewResponse(args: { apiKey: string; baseUrl: string; hospitableReviewId: string; responseText: string; ctx?: UsageLogCtx }): Promise<{ id: string; respondedAt: string }>`. **Not** a Convex `action()` wrapper — per the Convex guideline "pull shared code into a helper function, don't call action-from-action unless crossing runtimes" — this is called in-process from `convex/guestReviews/actions.ts::sendApprovedReply` (Task 11).

- [ ] **Step 1: Add the function**

Append to `convex/hospitable/actions.ts`:

```ts
/**
 * POST /v2/reviews/{uuid}/respond — publishes a reply to a guest review on
 * Airbnb (also supports Booking.com per Hospitable's docs, but we don't
 * operate there). Plain exported function, NOT a Convex action — called
 * in-process from convex/guestReviews/actions.ts::sendApprovedReply to
 * avoid an unnecessary action-to-action runtime hop (both run on the
 * default V8 runtime; see convex/_generated/ai/guidelines.md).
 */
export async function postReviewResponse(args: {
  apiKey: string;
  baseUrl: string;
  hospitableReviewId: string;
  responseText: string;
  ctx?: UsageLogCtx;
}): Promise<{ id: string; respondedAt: string }> {
  const url = `${args.baseUrl}/reviews/${args.hospitableReviewId}/respond`;
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ response: args.responseText }),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error ?? "unknown");
    if (args.ctx) {
      try {
        await args.ctx.runMutation(internal.serviceUsage.logger.log, {
          serviceKey: "hospitable",
          feature: "hospitable_review_respond",
          status: "timeout",
          durationMs: Date.now() - startedAt,
          errorMessage: errorMessage.slice(0, 500),
          metadata: { url: stripUrlSecrets(url) },
        });
      } catch {
        // best-effort
      }
    }
    throw new Error(`Network error posting review response: ${errorMessage}`);
  }

  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const errorBody = await response.text();
    if (args.ctx) {
      try {
        await args.ctx.runMutation(internal.serviceUsage.logger.log, {
          serviceKey: "hospitable",
          feature: "hospitable_review_respond",
          status: classifyHttpStatus(response.status),
          durationMs,
          errorCode: String(response.status),
          errorMessage: errorBody.slice(0, 500),
          metadata: { url: stripUrlSecrets(url) },
        });
      } catch {
        // best-effort
      }
    }
    throw new Error(`Hospitable respond-to-review failed (${response.status}): ${errorBody}`);
  }

  const json = (await response.json()) as { id?: string; responded_at?: string };
  if (args.ctx) {
    try {
      await args.ctx.runMutation(internal.serviceUsage.logger.log, {
        serviceKey: "hospitable",
        feature: "hospitable_review_respond",
        status: "success",
        durationMs,
        metadata: { url: stripUrlSecrets(url) },
      });
    } catch {
      // best-effort
    }
  }

  return {
    id: json.id ?? args.hospitableReviewId,
    respondedAt: json.responded_at ?? new Date().toISOString(),
  };
}
```

This reuses the existing private `classifyHttpStatus` and `stripUrlSecrets` helpers already defined in this file (confirmed present alongside `fetchHospitableJson`) — no new helper needed for those.

- [ ] **Step 2: Commit**

```bash
git add convex/hospitable/actions.ts
git commit -m "feat(reviews): add Hospitable respond-to-review send helper"
```

---

## Task 9: Domain queries — `convex/guestReviews/queries.ts`

**Files:**
- Create: `convex/guestReviews/queries.ts`

**Interfaces:**
- Produces: `listInbox` (public query), `listByProperty` (public query). Both require `admin` or `property_ops` role via `requireRole`.

- [ ] **Step 1: Write the file**

```ts
// convex/guestReviews/queries.ts
import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireRole } from "../lib/auth";

const guestReviewValidator = v.object({
  _id: v.id("guestReviews"),
  _creationTime: v.number(),
  hospitableReviewId: v.string(),
  propertyId: v.id("properties"),
  propertyName: v.optional(v.string()),
  platform: v.union(v.literal("airbnb"), v.literal("direct")),
  rating: v.number(),
  publicReview: v.string(),
  privateFeedback: v.optional(v.string()),
  guestFirstName: v.string(),
  guestLastName: v.string(),
  reviewedAt: v.number(),
  canRespond: v.boolean(),
  status: v.union(
    v.literal("needs_draft"),
    v.literal("drafted"),
    v.literal("sending"),
    v.literal("sent"),
    v.literal("dismissed"),
    v.literal("send_failed"),
  ),
  aiDraftText: v.optional(v.string()),
  aiDraftGeneratedAt: v.optional(v.number()),
  respondedText: v.optional(v.string()),
  respondedAt: v.optional(v.number()),
  sendError: v.optional(v.string()),
});

// Needs-action statuses sort first in the inbox.
const NEEDS_ACTION = new Set(["needs_draft", "drafted", "send_failed"]);

/**
 * Cross-property inbox, needs-action reviews first (needs_draft, drafted,
 * send_failed), then everything else, both groups newest-reviewed first.
 */
export const listInbox = query({
  args: {},
  returns: v.array(guestReviewValidator),
  handler: async (ctx) => {
    await requireRole(ctx, ["admin", "property_ops"]);

    const rows = await ctx.db.query("guestReviews").collect();
    const withNames = await Promise.all(
      rows.map(async (row) => {
        const property = await ctx.db.get(row.propertyId);
        return { ...row, propertyName: property?.name };
      }),
    );

    return withNames.sort((a, b) => {
      const aNeeds = NEEDS_ACTION.has(a.status) ? 0 : 1;
      const bNeeds = NEEDS_ACTION.has(b.status) ? 0 : 1;
      if (aNeeds !== bNeeds) return aNeeds - bNeeds;
      return b.reviewedAt - a.reviewedAt;
    });
  },
});

/** Reviews for a single property, for the property-detail Reviews section. */
export const listByProperty = query({
  args: { propertyId: v.id("properties") },
  returns: v.array(guestReviewValidator),
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops"]);

    const rows = await ctx.db
      .query("guestReviews")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();

    const property = await ctx.db.get(args.propertyId);
    return rows
      .map((row) => ({ ...row, propertyName: property?.name }))
      .sort((a, b) => b.reviewedAt - a.reviewedAt);
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add convex/guestReviews/queries.ts
git commit -m "feat(reviews): add guestReviews inbox and per-property queries"
```

---

## Task 10: Domain mutations — `convex/guestReviews/mutations.ts`

**Files:**
- Create: `convex/guestReviews/mutations.ts`

**Interfaces:**
- Consumes: `assertTransition`, `InvalidReviewTransitionError` (Task 3).
- Produces: `dismiss` (public), `approveAndSend` (public), `markSent` (internal), `markSendFailed` (internal), `retrySend` (public).

- [ ] **Step 1: Write the file**

```ts
// convex/guestReviews/mutations.ts
import { v } from "convex/values";
import { mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireRole } from "../lib/auth";
import { assertTransition, InvalidReviewTransitionError } from "./statusMachine";

/** Skip a review that doesn't need a reply (e.g. a glowing 5-star review). */
export const dismiss = mutation({
  args: { reviewId: v.id("guestReviews") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops"]);

    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("Review not found.");

    assertTransition(review.status, "dismissed");
    await ctx.db.patch(args.reviewId, { status: "dismissed" });
    return null;
  },
});

/**
 * Approve the (possibly edited) draft and publish it. Flips status to
 * "sending" atomically in this mutation — a concurrent second click sees
 * status !== "drafted" and throws InvalidReviewTransitionError, which the
 * UI treats as a no-op ("someone already sent this"). The actual Hospitable
 * API call happens in the scheduled action, not here, because mutations
 * cannot make outbound network calls.
 */
export const approveAndSend = mutation({
  args: { reviewId: v.id("guestReviews"), responseText: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin", "property_ops"]);

    const trimmed = args.responseText.trim();
    if (!trimmed) throw new Error("Response text cannot be empty.");

    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("Review not found.");

    assertTransition(review.status, "sending");
    await ctx.db.patch(args.reviewId, {
      status: "sending",
      respondedText: trimmed,
      respondedBy: user._id,
      sendError: undefined,
    });

    await ctx.scheduler.runAfter(0, internal.guestReviews.actions.sendApprovedReply, {
      reviewId: args.reviewId,
    });

    return null;
  },
});

/** Retry a failed send — re-enters "sending" and re-schedules the action. */
export const retrySend = mutation({
  args: { reviewId: v.id("guestReviews") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops"]);

    const review = await ctx.db.get(args.reviewId);
    if (!review) throw new Error("Review not found.");

    assertTransition(review.status, "sending");
    await ctx.db.patch(args.reviewId, { status: "sending", sendError: undefined });

    await ctx.scheduler.runAfter(0, internal.guestReviews.actions.sendApprovedReply, {
      reviewId: args.reviewId,
    });

    return null;
  },
});

/** Called by sendApprovedReply on a successful Hospitable API response. */
export const markSent = internalMutation({
  args: { reviewId: v.id("guestReviews"), respondedAt: v.number() },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return;
    assertTransition(review.status, "sent");
    await ctx.db.patch(args.reviewId, { status: "sent", respondedAt: args.respondedAt });
  },
});

/** Called by sendApprovedReply when the Hospitable API call fails. */
export const markSendFailed = internalMutation({
  args: { reviewId: v.id("guestReviews"), error: v.string() },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return;
    assertTransition(review.status, "send_failed");
    await ctx.db.patch(args.reviewId, { status: "send_failed", sendError: args.error });
  },
});

export { InvalidReviewTransitionError };
```

- [ ] **Step 2: Typecheck**

Now that Tasks 5, 9, 10 all exist, run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: no errors. If `internal.guestReviews.actions.*` errors appear, that's expected until Task 11 lands next.

- [ ] **Step 3: Commit**

```bash
git add convex/guestReviews/mutations.ts
git commit -m "feat(reviews): add guestReviews workflow mutations (dismiss/approve/retry)"
```

---

## Task 11: Domain actions — draft generation + send

**Files:**
- Create: `convex/guestReviews/actions.ts`

**Interfaces:**
- Consumes: `draftReviewResponse` (Task 4), `postReviewResponse` (Task 8), `internal.guestReviews.mutations.markSent`/`markSendFailed` (Task 10).
- Produces: `generateDraft` (internal action, target of the `ctx.scheduler.runAfter` call added in Task 5), `sendApprovedReply` (internal action, target of the calls added in Task 10).

- [ ] **Step 1: Write the file**

```ts
// convex/guestReviews/actions.ts
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { draftReviewResponse, ReviewResponseDraftError } from "../lib/reviewResponseDraft";
import { postReviewResponse } from "../hospitable/actions";

const DEFAULT_HOSPITABLE_BASE_URL = "https://public.api.hospitable.com/v2";

/**
 * Generates an AI draft reply for a newly-ingested review. Triggered by
 * upsertGuestReview on first insert (status: "needs_draft"), and re-triggered
 * on every re-sync while a row remains stuck in "needs_draft" (see
 * upsertGuestReview's re-schedule branch in Task 5). On Gemini failure the
 * row is simply left untouched — it stays "needs_draft" for the next retry.
 */
export const generateDraft = internalAction({
  args: { reviewId: v.id("guestReviews") },
  handler: async (ctx, args): Promise<void> => {
    const review = await ctx.runQuery(internal.guestReviews.internalQueries.getById, {
      reviewId: args.reviewId,
    });
    if (!review || review.status !== "needs_draft") return;

    const property = await ctx.runQuery(internal.guestReviews.internalQueries.getPropertyName, {
      propertyId: review.propertyId,
    });

    try {
      const draftText = await draftReviewResponse({
        rating: review.rating,
        publicReview: review.publicReview,
        guestFirstName: review.guestFirstName,
        propertyName: property?.name ?? "the property",
      });

      await ctx.runMutation(internal.guestReviews.mutations.saveDraft, {
        reviewId: args.reviewId,
        draftText,
      });
    } catch (error) {
      const message =
        error instanceof ReviewResponseDraftError ? error.message : String(error);
      console.error("guestReviews.generateDraft failed", { reviewId: args.reviewId, message });
      // Row stays "needs_draft" — no state change, safe to leave for a
      // manual re-trigger or the next ingestion pass to retry.
    }
  },
});

/**
 * Publishes the approved (possibly edited) reply to Hospitable. Triggered
 * by approveAndSend / retrySend after they flip status to "sending".
 */
export const sendApprovedReply = internalAction({
  args: { reviewId: v.id("guestReviews") },
  handler: async (ctx, args): Promise<void> => {
    const review = await ctx.runQuery(internal.guestReviews.internalQueries.getById, {
      reviewId: args.reviewId,
    });
    if (!review || review.status !== "sending" || !review.respondedText) return;

    const apiKey = process.env.HOSPITABLE_API_KEY ?? process.env.HOSPITABLE_API_TOKEN;
    if (!apiKey) {
      await ctx.runMutation(internal.guestReviews.mutations.markSendFailed, {
        reviewId: args.reviewId,
        error: "Missing HOSPITABLE_API_KEY/HOSPITABLE_API_TOKEN environment variable.",
      });
      return;
    }
    const baseUrl = process.env.HOSPITABLE_API_URL ?? DEFAULT_HOSPITABLE_BASE_URL;

    try {
      const result = await postReviewResponse({
        apiKey,
        baseUrl,
        hospitableReviewId: review.hospitableReviewId,
        responseText: review.respondedText,
        ctx,
      });
      await ctx.runMutation(internal.guestReviews.mutations.markSent, {
        reviewId: args.reviewId,
        respondedAt: Date.parse(result.respondedAt) || Date.now(),
      });
    } catch (error) {
      await ctx.runMutation(internal.guestReviews.mutations.markSendFailed, {
        reviewId: args.reviewId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});
```

- [ ] **Step 2: Add the small internal query/mutation helpers these actions call**

Actions can't read `ctx.db` directly — they need `internal.guestReviews.internalQueries.getById` etc. Create `convex/guestReviews/internalQueries.ts`:

```ts
// convex/guestReviews/internalQueries.ts
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const getById = internalQuery({
  args: { reviewId: v.id("guestReviews") },
  handler: async (ctx, args) => ctx.db.get(args.reviewId),
});

export const getPropertyName = internalQuery({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => ctx.db.get(args.propertyId),
});
```

And add `saveDraft` to `convex/guestReviews/mutations.ts` (append):

```ts
export const saveDraft = internalMutation({
  args: { reviewId: v.id("guestReviews"), draftText: v.string() },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return;
    assertTransition(review.status, "drafted");
    await ctx.db.patch(args.reviewId, {
      status: "drafted",
      aiDraftText: args.draftText,
      aiDraftGeneratedAt: Date.now(),
    });
  },
});
```

`saveDraft` lives in `mutations.ts` (not a separate `internalMutations.ts` file), matching `generateDraft`'s call to `internal.guestReviews.mutations.saveDraft` in Step 1.

- [ ] **Step 3: Run the full project typecheck**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: zero errors across `convex/hospitable/*.ts` and `convex/guestReviews/*.ts`. This is the first point where Tasks 5–11's cross-references (`internal.guestReviews.actions.generateDraft`, `internal.guestReviews.mutations.markSent`/`markSendFailed`/`saveDraft`) all resolve — fix any typos in function-reference paths now.

- [ ] **Step 4: Run all guestReviews and reviewResponseDraft unit tests together**

Run: `node --test convex/guestReviews/*.test.ts convex/lib/reviewResponseDraft.test.ts`
Expected: all tests from Tasks 2–4 still PASS (this task didn't touch pure modules, just wires them — regression check).

- [ ] **Step 5: Commit**

```bash
git add convex/guestReviews/actions.ts convex/guestReviews/internalQueries.ts convex/guestReviews/mutations.ts
git commit -m "feat(reviews): add draft-generation and send-to-Hospitable actions"
```

---

## Task 12: Shared UI component — `ReviewCard`

**Files:**
- Create: `src/components/reviews/review-card.tsx`

**Interfaces:**
- Consumes: the row shape returned by `api.guestReviews.queries.listInbox`/`listByProperty` (Task 9).
- Produces: `<ReviewCard review={...} showProperty={boolean} />` React component. Consumed by Tasks 13 and 14.

- [ ] **Step 1: Write the component**

```tsx
// src/components/reviews/review-card.tsx
"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Star, Loader2, Send, X, RotateCcw } from "lucide-react";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast-provider";

export type ReviewRow = {
  _id: Id<"guestReviews">;
  propertyId: Id<"properties">;
  propertyName?: string;
  platform: "airbnb" | "direct";
  rating: number;
  publicReview: string;
  guestFirstName: string;
  guestLastName: string;
  reviewedAt: number;
  status: "needs_draft" | "drafted" | "sending" | "sent" | "dismissed" | "send_failed";
  aiDraftText?: string;
  respondedText?: string;
  sendError?: string;
};

const STATUS_LABEL: Record<ReviewRow["status"], string> = {
  needs_draft: "Drafting…",
  drafted: "Needs approval",
  sending: "Sending…",
  sent: "Sent",
  dismissed: "Dismissed",
  send_failed: "Send failed",
};

const STATUS_CLASS: Record<ReviewRow["status"], string> = {
  needs_draft: "bg-slate-100 text-slate-700 border-slate-200",
  drafted: "bg-amber-100 text-amber-700 border-amber-200",
  sending: "bg-blue-100 text-blue-700 border-blue-200",
  sent: "bg-emerald-100 text-emerald-700 border-emerald-200",
  dismissed: "bg-slate-100 text-slate-500 border-slate-200",
  send_failed: "bg-rose-100 text-rose-700 border-rose-200",
};

export function ReviewCard({
  review,
  showProperty,
}: {
  review: ReviewRow;
  showProperty: boolean;
}) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState(review.aiDraftText ?? "");
  const [pending, setPending] = useState(false);

  const approveAndSend = useMutation(api.guestReviews.mutations.approveAndSend);
  const dismiss = useMutation(api.guestReviews.mutations.dismiss);
  const retrySend = useMutation(api.guestReviews.mutations.retrySend);

  const canReply = review.platform === "airbnb";
  const isEditable = review.status === "drafted";

  async function handleApprove() {
    setPending(true);
    try {
      await approveAndSend({ reviewId: review._id, responseText: draft });
      showToast({ title: "Reply queued for publishing", variant: "success" });
    } catch (error) {
      showToast({ title: "Failed to send reply", description: getErrorMessage(error), variant: "error" });
    } finally {
      setPending(false);
    }
  }

  async function handleDismiss() {
    setPending(true);
    try {
      await dismiss({ reviewId: review._id });
    } catch (error) {
      showToast({ title: "Failed to dismiss", description: getErrorMessage(error), variant: "error" });
    } finally {
      setPending(false);
    }
  }

  async function handleRetry() {
    setPending(true);
    try {
      await retrySend({ reviewId: review._id });
      showToast({ title: "Retrying send…", variant: "success" });
    } catch (error) {
      showToast({ title: "Retry failed", description: getErrorMessage(error), variant: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-[var(--card)] p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`h-4 w-4 ${i < review.rating ? "fill-amber-400 text-amber-400" : "text-slate-300"}`}
              />
            ))}
          </div>
          <span className="text-sm font-medium">
            {review.guestFirstName} {review.guestLastName}
          </span>
          {showProperty && review.propertyName && (
            <span className="text-xs text-[var(--muted-foreground)]">· {review.propertyName}</span>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_CLASS[review.status]}`}>
          {STATUS_LABEL[review.status]}
        </span>
      </div>

      <p className="text-sm text-[var(--foreground)]">{review.publicReview}</p>

      {!canReply && (
        <p className="text-xs text-[var(--muted-foreground)] italic">
          Direct booking — no OTA reply target, read-only.
        </p>
      )}

      {canReply && review.status === "send_failed" && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2">
          {review.sendError ?? "Send failed."}
        </div>
      )}

      {canReply && (review.status === "drafted" || review.status === "send_failed") && (
        <textarea
          className="w-full rounded-md border p-2 text-sm"
          rows={3}
          value={draft}
          disabled={!isEditable && review.status !== "send_failed"}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}

      {canReply && review.status === "sent" && review.respondedText && (
        <div className="text-sm bg-emerald-50 border border-emerald-200 rounded-md p-2">
          {review.respondedText}
        </div>
      )}

      {canReply && review.status === "drafted" && (
        <div className="flex gap-2">
          <button
            onClick={handleApprove}
            disabled={pending || !draft.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Approve &amp; Send
          </button>
          <button
            onClick={handleDismiss}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Dismiss
          </button>
        </div>
      )}

      {canReply && review.status === "send_failed" && (
        <button
          onClick={handleRetry}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Retry Send
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/reviews/review-card.tsx
git commit -m "feat(reviews): add shared ReviewCard component"
```

---

## Task 13: Reviews inbox page + nav entry

**Files:**
- Create: `src/app/(dashboard)/reviews/page.tsx`
- Create: `src/components/reviews/reviews-inbox.tsx`
- Modify: `src/components/layout/navigation.ts`

**Interfaces:**
- Consumes: `ReviewCard` (Task 12), `api.guestReviews.queries.listInbox` (Task 9), `api.admin.featureFlags.isFeatureEnabled` (Task 1).

- [ ] **Step 1: Write the client component**

```tsx
// src/components/reviews/reviews-inbox.tsx
"use client";

import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Loader2 } from "lucide-react";
import { ReviewCard } from "./review-card";

type StatusFilter = "all" | "needs_action" | "sent" | "dismissed";

const NEEDS_ACTION = new Set(["needs_draft", "drafted", "send_failed"]);

export function ReviewsInbox() {
  const { isAuthenticated } = useConvexAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("needs_action");

  const enabled = useQuery(
    api.admin.featureFlags.isFeatureEnabled,
    isAuthenticated ? { key: "reviewsAiReply" } : "skip",
  );
  const reviews = useQuery(
    api.guestReviews.queries.listInbox,
    isAuthenticated ? {} : "skip",
  );

  if (enabled === undefined || reviews === undefined) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="rounded-2xl border bg-[var(--card)] p-8 text-center text-sm text-[var(--muted-foreground)]">
        Reviews is not enabled yet. An admin can turn it on from Settings → Integrations → Feature Flags.
      </div>
    );
  }

  const filtered = reviews.filter((r) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "needs_action") return NEEDS_ACTION.has(r.status);
    if (statusFilter === "sent") return r.status === "sent";
    return r.status === "dismissed";
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["needs_action", "all", "sent", "dismissed"] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs ${
              statusFilter === f ? "bg-[var(--foreground)] text-[var(--background)]" : ""
            }`}
          >
            {f === "needs_action" ? "Needs action" : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border bg-[var(--card)] p-8 text-center text-sm text-[var(--muted-foreground)]">
          No reviews in this view.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((review) => (
            <ReviewCard key={review._id} review={review} showProperty />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the route wrapper**

```tsx
// src/app/(dashboard)/reviews/page.tsx
import { ReviewsInbox } from "@/components/reviews/reviews-inbox";

export default function ReviewsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reviews</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          AI-drafted replies to guest reviews — approve, edit, or dismiss.
        </p>
      </div>
      <ReviewsInbox />
    </div>
  );
}
```

- [ ] **Step 3: Add the nav entry**

In `src/components/layout/navigation.ts`, add `MessageCircle` (or reuse an existing unused icon — check the `lucide-react` import list; `Star` fits the review theme) to the icon import list, and insert a new entry after `common.messages` (before the `nav.review` job-review entry, to avoid confusion with that unrelated existing `/review` route):

```ts
import {
  LayoutDashboard,
  Calendar,
  ClipboardList,
  ClipboardCheck,
  ListChecks,
  MessageSquare,
  Star,
  Building2,
  Building,
  Users,
  UserCog,
  Package,
  AlertTriangle,
  BarChart3,
  Calculator,
  Receipt,
  Settings,
} from "lucide-react";
```

```ts
  {
    nameKey: "common.messages",
    href: "/messages",
    icon: MessageSquare,
    roles: ["admin", "property_ops", "manager"],
  },
  {
    nameKey: "nav.reviews",
    href: "/reviews",
    icon: Star,
    roles: ["admin", "property_ops"],
  },
```

(The feature flag, not the nav `roles` array, is what actually hides this from users before rollout — the nav entry is visible to admin/property_ops but the page itself shows the "not enabled yet" empty state until the flag is flipped on, consistent with how other flagged features in this codebase behave.)

Add the translation string to both locale files, next to the existing `"review"` key under `"nav"` (confirmed at `src/messages/en.json:41` and `src/messages/es.json:41`):

In `src/messages/en.json`, inside the `"nav"` object:
```json
    "review": "Review",
    "reviews": "Reviews",
```

In `src/messages/es.json`, inside the `"nav"` object:
```json
    "review": "Revisión",
    "reviews": "Reseñas",
```

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: build succeeds with no new errors (missing i18n keys typically warn, not fail — but add them per Step 3's note regardless).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/reviews/page.tsx src/components/reviews/reviews-inbox.tsx src/components/layout/navigation.ts src/messages/*.json
git commit -m "feat(reviews): add Reviews inbox page and nav entry"
```

---

## Task 14: Property-detail Reviews section

**Files:**
- Modify: `src/components/properties/property-detail.tsx`

**Interfaces:**
- Consumes: `ReviewCard` (Task 12), `api.guestReviews.queries.listByProperty` (Task 9), `api.admin.featureFlags.isFeatureEnabled` (Task 1).

- [ ] **Step 1: Add the section**

`property-detail.tsx` already imports `useQuery`, `api`, and `Id` (from `@convex/_generated/dataModel`) for its existing queries — only `ReviewCard` is new. Add this import alongside the other `@/components/properties/*` imports near the top:

```tsx
import { ReviewCard } from "@/components/reviews/review-card";
```

Inside the `PropertyDetail` component function (which takes `{ id }: { id: string }`), immediately after the existing `propertyCompanyAssignment` query (following the file's established `isAuthenticated ? {...} : "skip"` and `id as never` casting convention used by every other query in this component), add:

```tsx
const reviewsEnabled = useQuery(
  api.admin.featureFlags.isFeatureEnabled,
  isAuthenticated ? { key: "reviewsAiReply" } : "skip",
);
const propertyReviews = useQuery(
  api.guestReviews.queries.listByProperty,
  isAuthenticated && reviewsEnabled ? { propertyId: id as never } : "skip",
);
```

Then, after the existing `<section className="rounded-2xl border bg-[var(--card)]">` Job History block (around line 242+), add a new sibling section:

```tsx
{reviewsEnabled && (
  <section className="rounded-2xl border bg-[var(--card)] p-5 space-y-3">
    <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
      Reviews
    </h2>
    {propertyReviews === undefined ? (
      <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
    ) : propertyReviews.length === 0 ? (
      <p className="text-sm text-[var(--muted-foreground)]">No reviews yet.</p>
    ) : (
      <div className="space-y-3">
        {propertyReviews.map((review) => (
          <ReviewCard key={review._id} review={review} showProperty={false} />
        ))}
      </div>
    )}
  </section>
)}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: build succeeds, no type errors in `property-detail.tsx`.

- [ ] **Step 3: Manual smoke test (requires local dev server + a seeded guestReviews row)**

Since live Hospitable data is blocked pending OAuth scope (see Global Constraints), verify the UI renders correctly against a manually-inserted row. Run `npx convex dev` in a separate terminal (against the worktree's own dev deployment, never the shared prod deployment), then from the Convex dashboard's function runner, call `api.admin.featureFlags.setFeatureFlag` with `{ key: "reviewsAiReply", enabled: true }` while signed in as an admin, and manually insert one `guestReviews` document with `status: "drafted"` and a non-empty `aiDraftText` via the dashboard's data browser. Load `/reviews` and the corresponding property's detail page in the browser; confirm the card renders, the draft is editable, and Approve/Dismiss buttons are present (do not click Approve — it will attempt a real Hospitable API call, which is expected to fail with the missing-scope error until the account is re-authorized; watch for a `send_failed` status attaching cleanly to the card as your `send_failed`-path confirmation).

- [ ] **Step 4: Commit**

```bash
git add src/components/properties/property-detail.tsx
git commit -m "feat(reviews): add Reviews section to property detail page"
```

---

## Final wrap-up (not a task — do after Task 14)

- [ ] Run the full test suite once more: `npm test` (runs `node --test`, which recursively discovers every `*.test.ts` under the repo by default).
- [ ] Run `npm run lint` and `npm run build` one last time across the whole worktree.
- [ ] Rebase on `origin/main` per `.harness/worktrees.md` before pushing: `git fetch origin && git rebase origin/main`.
- [ ] Push and open a PR per `.harness/worktrees.md`'s template, noting in the PR body: "Schema impact: backward-compatible (additive `guestReviews` table + `reviewsAiReply` flag)" and flagging the blocked Hospitable OAuth scope grant as a pre-req for the main session's post-merge manual QA.
- [ ] Write `.harness/handoffs/TASK-REVIEW-RESPONSE-AI/worktree-handoff.md` and append the entry to `.harness/integration-queue.md` under `## Ready`, per this repo's handoff protocol.
