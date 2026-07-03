# AI Review-Response — Design

**Status:** Approved
**Date:** 2026-07-03
**Author:** Claude (with Bertrand)

---

## 1. Context

This is the next item on the [YC readiness gap analysis](../../../../opscentral-admin-trellis-gap-analysis/GAP-ANALYSIS.md) (`G-7`), benchmarked against Trellis (YC W25) — an autonomous-agent competitor for STR operators. Two of the five "lowest-cost moves" from that analysis have already shipped:

1. ✅ Hospitable webhook (event-driven scheduling instead of polling)
2. ✅ Owner-facing PDF report (Owner Portal + Monthly Close)

This design covers item 3: **AI-drafted, human-approved replies to guest reviews**, published back to Airbnb through Hospitable's API. It reuses the existing Gemini message-polish stack (`convex/lib/messageEnhance.ts`) and the existing Hospitable webhook/cron ingestion architecture (`convex/hospitable/webhooks.ts`, `convex/crons.ts`).

## 2. Goals / non-goals

**Goals:**
- Ingest guest reviews from Hospitable (Airbnb + direct bookings) in near-real-time.
- Generate an AI-drafted reply for each review that needs one.
- Let an admin or property_ops user review, edit, and approve a reply.
- Publish the approved reply back to Airbnb via Hospitable's respond-to-review API.
- Surface pending replies as a triage inbox, plus a per-property read view.

**Non-goals (v1):**
- VRBO reviews — Hospitable's API does not expose VRBO review data or accept VRBO responses at all (confirmed via their public docs: the `review.created` webhook sources "Airbnb and our own direct bookings" only, and `POST /v2/reviews/{uuid}/respond` "currently supports Airbnb and Booking.com"). No workaround (e.g. manual paste-in) is built for this gap in v1 — it's a known, documented limitation.
- Booking.com — technically supported by the respond endpoint, but not a channel J&A operates on. Not built.
- Replying to reviews on `platform: "direct"` bookings — there's no OTA reply target for these; shown read-only in the inbox.
- Auto-send without human approval — every reply requires an explicit Approve & Send action.

## 3. Data model

New table in `convex/schema.ts`:

```ts
const guestReviews = defineTable({
  hospitableReviewId: v.string(),          // Hospitable's review UUID
  propertyId: v.id("properties"),
  platform: v.union(v.literal("airbnb"), v.literal("direct")),
  rating: v.number(),                       // 1-5
  publicReview: v.string(),
  privateFeedback: v.optional(v.string()),
  guestFirstName: v.string(),
  guestLastName: v.string(),
  reviewedAt: v.number(),                   // ms epoch, from Hospitable's reviewed_at
  canRespond: v.boolean(),                  // mirrors Hospitable's can_respond
  status: v.union(
    v.literal("needs_draft"),
    v.literal("drafted"),
    v.literal("sending"),      // set by the approve mutation before the send action runs
    v.literal("sent"),
    v.literal("dismissed"),
    v.literal("send_failed"),
  ),
  aiDraftText: v.optional(v.string()),
  aiDraftGeneratedAt: v.optional(v.number()),
  respondedText: v.optional(v.string()),    // what was actually sent — may differ from the AI draft if a human edited it
  respondedAt: v.optional(v.number()),
  respondedBy: v.optional(v.id("users")),
  sendError: v.optional(v.string()),
})
  .index("by_hospitable_review_id", ["hospitableReviewId"])
  .index("by_property", ["propertyId"])
  .index("by_status", ["status"]);
```

Status is a state machine, following the same shape as `ownerStatements.status`:

```
needs_draft ──(AI action)──> drafted ──(approve mutation)──> sending ──(API success)──> sent
                 │                                               │
                 └──(dismiss)──> dismissed                       └──(API error)──> send_failed ──(retry)──> sending
```

## 4. Ingestion — webhook + daily backstop

`convex/hospitable/webhooks.ts::ingestEvent` already receives **every** Hospitable webhook delivery and logs it to `hospitableWebhookEvents`, but only branches on `RESERVATION_EVENT_ACTIONS` — everything else (including `review.created`, which Hospitable already sends us today) is currently a no-op recorded "for observability."

Changes:
- Add a `REVIEW_EVENT_ACTIONS = new Set(["review.created"])` branch that extracts the review payload and calls a new `upsertGuestReview` mutation (mirrors `upsertSingleReservation`'s role for reservations).
- Add a **daily** cron (`sync-hospitable-reviews-daily`, 24h interval — reviews are far lower-volume/lower-urgency than reservations, hourly would be overkill) that calls `GET /v2/properties/{uuid}/reviews` for every property with `hospitableId` set. This backfills history on first rollout and catches any webhook deliveries that failed HMAC checks or arrived during a deploy window, exactly like `syncPropertyDetails` does today for property data.
- New reviews land with `status: "needs_draft"`; the upsert mutation schedules the AI-draft action via `ctx.scheduler.runAfter(0, ...)`, matching the event-driven pattern already used for maintenance-approval escalation.

**External dependency, blocking:** `Docs/runbooks/hospitable-webhook-token-auth.md` explicitly scoped reviews out of Phase 0 — our Hospitable OAuth connection does not currently have `reviews:read` or `reviews:write` granted. Whoever owns that connection needs to re-authorize with both scopes before any of this can run against real data. This is a business/account action, not a code change, and should happen before or during implementation so the plan isn't blocked at the last step.

## 5. AI draft generation

New `convex/lib/reviewResponseDraft.ts`, matching `messageEnhance.ts`'s shape exactly: a pure function, no Convex bindings, same env var (`GOOGLE_GENERATIVE_AI_API_KEY` / `GEMINI_API_KEY`), same error-class pattern (`ReviewResponseDraftError`).

```ts
export async function draftReviewResponse(input: {
  rating: number;
  publicReview: string;
  guestFirstName: string;
  propertyName: string;
}): Promise<string>
```

Prompt constraints:
- Thank the guest by first name, address specifics they raised (not generic).
- Match tone to rating — warm and appreciative for 4-5 stars; measured, non-defensive acknowledgment for 1-3 stars, no excuses or blame.
- No discount offers, no legal/liability language, no promises of specific fixes with dates.
- Airbnb-appropriate length (2-4 sentences).
- Output the reply only — no preamble, no quotes.

A Convex action (`convex/guestReviews/actions.ts::generateDraft`) calls this whenever a review lands with `status: "needs_draft"`, then patches the row to `status: "drafted"` with `aiDraftText` + `aiDraftGeneratedAt`. On Gemini failure, the row stays `needs_draft` and is retried by the next daily sync pass (same graceful-degradation behavior as other Gemini call sites in this codebase).

## 6. Approve & publish flow

- UI shows the AI draft in an editable text field, defaulting to the AI text.
- **Approve & Send**: mutation `approveAndSend` checks `status === "drafted"` and atomically flips it to `"sending"` before scheduling the send action (guards against a double-click race — two clicks resolve to one winner, the loser's mutation sees `status !== "drafted"` and no-ops).
- The action calls `POST /v2/reviews/{hospitableReviewId}/respond` with the (possibly edited) text. Hospitable's own `can_respond` flag is a second line of defense — an already-answered review will reject a duplicate response server-side even if our guard somehow raced.
- Success → `status: "sent"`, `respondedText`, `respondedAt`, `respondedBy` recorded.
- Failure (network/4XX) → `status: "send_failed"` with `sendError` message surfaced in the UI; a **Retry** action re-attempts the same call.
- **Dismiss**: for reviews that don't need a reply (common for glowing 5-star reviews) — flips straight to `dismissed`, no API call.

## 7. UI surfaces

Both, per your call:

1. **New top-level "Reviews" nav item** (sidebar, sibling to Jobs/Properties/Team) — the primary inbox. Sorted `needs_draft`/`drafted` first (things needing action), then everything else. Filterable by property, rating, and status. This is the main demo screen.
2. **"Reviews" tab on the existing property-detail page** — same list/detail components, scoped to `by_property` index, for staff already looking at one property.

Both surfaces share the same review-card and approve/dismiss components — no duplicated logic.

## 8. Access & rollout

- **Roles:** admin + property_ops (matches their existing access to jobs/properties/team/reports).
- **Feature flag:** ships behind `reviewsAiReply` (default OFF), per the project's mandatory feature-flag rule (`Docs/feature-flags/PATTERN.md`). Enable for the J&A team first via Settings → Integrations → Feature Flags; watch real sends before considering wider exposure.

## 9. Testing

Tests are colocated `*.test.ts` files next to the source they cover (e.g. `convex/owner/feeEngine.test.ts`, `convex/lib/companyScope.test.ts`), run via Node's built-in test runner (`npm test` → `node --test`). Note: `convex/lib/messageEnhance.ts` — the file this design's AI helper mirrors in shape — has no existing test file to follow as a template, so the tests below are new, not adapted from a sibling.

- `convex/lib/reviewResponseDraft.test.ts` — unit tests for `draftReviewResponse` (pure function — mock fetch, assert prompt construction and error handling).
- `convex/guestReviews/*.test.ts` — unit tests for the status-machine mutations (`upsertGuestReview`, `approveAndSend`, `dismiss`, retry-after-`send_failed`) — particularly the double-click/race guard on `approveAndSend`.
- Webhook ingestion test: a `review.created` payload through `ingestEvent` produces exactly one `guestReviews` row, and a duplicate delivery (same `hospitableEventId`) is a no-op (existing dedup behavior, just needs a review-flavored payload fixture added).

## 10. Open items carried into planning

- Exact Gemini prompt wording will be iterated during implementation/testing — the constraints above are fixed, the phrasing is not.
- Whether `send_failed` reviews need a notification (e.g. to admin) or are purely surfaced via the inbox's status filter — default to inbox-only for v1, revisit if reviews sit un-retried in practice.
