# Worktree Handoff

## Task
TASK-REVIEW-RESPONSE-AI

## Type
implementation

## Branch
task/review-response-ai

## Worktree
~/sites/opscentral-admin-review-response-ai

## Base
origin/main @ d61f56d1d5647b68b65470042b523955414e540b

## Status
ready-for-integration

## What changed
- New `guestReviews` Convex table (status state machine: needs_draft → drafted → sending → sent, with dismissed/send_failed branches) + `reviewsAiReply` feature flag (default OFF)
- Guest-review ingestion: `review.created` webhook branch in `convex/hospitable/webhooks.ts`, plus a daily backstop sync (`convex/hospitable/actions.ts::syncGuestReviews`) for backfill/reconciliation
- AI draft generation: `convex/lib/reviewResponseDraft.ts` (Gemini, mirrors `messageEnhance.ts`'s shape), triggered on ingestion via `convex/guestReviews/actions.ts::generateDraft`
- Approve/send workflow: `convex/guestReviews/mutations.ts` (dismiss/approveAndSend/retrySend/markSent/markSendFailed) + `convex/guestReviews/actions.ts::sendApprovedReply`, which calls `convex/hospitable/actions.ts::postReviewResponse` (a plain function, not a Convex action, per the Convex action-to-action guideline)
- Two UI surfaces: top-level `/reviews` inbox page, and a Reviews section on the property-detail page — both gated behind `reviewsAiReply` and `requireRole(["admin", "property_ops"])`
- Full design spec + implementation plan committed at `docs/superpowers/specs/2026-07-03-review-response-ai-design.md` and `docs/superpowers/plans/2026-07-03-review-response-ai.md`

Built via subagent-driven development: 14 plan tasks + 1 post-final-review fix task, each independently implemented and reviewed (fresh subagent per task, task-scoped spec+quality review). A final whole-branch review (opus) traced the state-machine for bypasses, the full ingestion→UI data flow, feature-flag gating at both UI entry points, and access control — found one Important issue (see "Known risks"), which was fixed and re-reviewed clean.

## What main should test
1. `npx convex dev --once` (regenerates codegen — see "Convex impact" below)
2. `npx tsc --noEmit -p convex/tsconfig.json` — should show 0 new errors after codegen; unrelated pre-existing failures in `convex/whatsapp/lib.test.ts` (missing `vitest` module) predate this branch
3. `npm run build && npm run lint`
4. `npm test` — this branch's own 22 tests (`convex/guestReviews/*.test.ts`, `convex/lib/reviewResponseDraft.test.ts`) pass cleanly. 7 pre-existing, branch-unrelated test-suite failures exist on `main` already (independently verified via a throwaway worktree at the merge-base commit before starting this work) — not introduced or worsened by this branch.
5. Enable `reviewsAiReply` via Settings → Integrations → Feature Flags; confirm the Reviews nav item and property-detail section render correctly with empty states (no live Hospitable review data yet — see business blocker below)
6. Once Hospitable OAuth scopes are granted (see below): trigger `internal.hospitable.actions.syncGuestReviews` once via the Convex dashboard to backfill, confirm a real review appears with an AI-generated draft, then do one supervised end-to-end approve→send on a low-stakes review before trusting the flow unattended

## Schema impact
backward-compatible — additive `guestReviews` table + `reviewsAiReply` feature-flag literal only. No existing table, field, or index modified.

## Convex impact
deploy-required. `convex/_generated/api.d.ts` currently predates this feature (last regenerated 2026-06-30) and has zero knowledge of the `guestReviews` module — this produces ~11 identical `TS2339: Property 'guestReviews' does not exist` typecheck errors on this branch right now, all independently confirmed (via direct `npx tsc` runs, not just implementer claims) to share this single root cause. Running `npx convex dev --once`/`deploy` resolves all of them automatically — this is the same step already required for any schema change, not an extra step this branch introduces.

## Commands main should run
- `npx convex dev --once` (regenerate codegen — required first, before the checks below will show a clean state)
- `npm run lint`
- `npm run build`
- `npm test`
- `npm run sync:convex-backend` from `jna-cleaners-app` after deploying, per this repo's standard cross-app mirror step (schema change affects the shared backend)

## Known risks
- **Business blocker, not a code risk:** Hospitable OAuth connection lacks `reviews:read`/`reviews:write` scopes. Ingestion and sending will 401/403 until someone with account access re-authorizes. This fails gracefully (caught, logged as `send_failed` with the error message, retryable) — not a crash risk, just a "feature does nothing yet" state until the scope grant happens.
- State-machine race conditions (double-draft, double-send) were explicitly traced during review and confirmed safe — the real guard is `assertTransition` running inside the relevant Convex *mutation* (transactional), not just a pre-check inside the calling *action* (not transactional). See PR #184 description and `.superpowers/sdd/progress.md` (local, not committed) for the full trace.
- Minor/non-blocking polish items from review, safe to defer: `reviewsAiReply` flag key is camelCase vs. the snake_case convention used by every other flag; `respondedBy` is recorded but not yet surfaced in the UI; the new `/reviews` nav label is easily confused with the existing unrelated `/review` (job-review) route at a glance; `internalQueries.getPropertyName` is a naming nit (returns the full property doc); `review-card.tsx` has one vestigial dead `disabled` expression on its textarea.

## Rollback plan
- `git revert` the merge commit. Schema is purely additive (no data written to `guestReviews` without the webhook/cron running, both of which require OAuth scopes not yet granted), so no data cleanup is needed for a same-day rollback.
- If `reviewsAiReply` was already enabled and any `guestReviews` rows exist, flip the flag off first (`setFeatureFlag`) to hide the UI immediately, independent of any code rollback.
