# Worktree Handoff

## Task
TASK-REVIEW-REPLY-CONTROLS-001

## Type
bugfix

## Branch
task/review-reply-controls

## Worktree
~/sites/opscentral-admin-team-redesign

## Base
origin/main @ 4193f0b

## Status
ready-for-integration

## What changed
- Added a real Hospitable `Send message` action to Review Opportunity outreach cards.
- Reused one shared AI-refine panel across outreach cards and guest-review response cards.
- Added provider-aware AI outreach refinement using the selected tone, length, incentive, and manager instruction.
- Resynchronized lower review-card draft state when the reactive Convex draft changes.
- Restricted review AI stay context to the matching guest, preventing another guest's stay details from entering a generated response.
- Added focused tests for the outreach AI prompt and Hospitable reservation-message request.

## What main should test
1. Expand two Review Opportunity rows and refine one; verify only that row's textarea changes.
2. Send one outreach message; verify Hospitable receives it and the row button changes to `Sent`.
3. Refine two lower guest-review cards; verify each generated response stays in its own card.
4. Confirm a review at a property with adjacent reservations uses the matching guest's stay context.

## Schema impact
none

## Convex impact
deploy-required

## Commands main should run
- `npm test -- convex/lib/reviewResponseDraft.test.ts convex/hospitable/postReservationMessage.test.ts`
- `npm run check:convex-readcost`
- `npm run lint`
- `npm run build`
- `npx convex deploy`
- In the cleaners repo: `npm run sync:convex-backend`

## Known risks
- The Hospitable token must include permission to send reservation messages; API rejection is surfaced as an error toast.
- AI refinement still depends on the selected provider's Convex environment key.
- Airbnb-masked guests named only `Guest` cannot be uniquely identity-matched; date proximity remains the practical discriminator for those records.

## Rollback plan
- Revert PR #285 and redeploy Convex. No schema or data cleanup is required.
