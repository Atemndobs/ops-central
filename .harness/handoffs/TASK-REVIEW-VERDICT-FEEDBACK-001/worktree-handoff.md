# Worktree Handoff

## Task
TASK-REVIEW-VERDICT-FEEDBACK-001

## Type
fix (UX / design)

## Branch
task/review-verdict-feedback

## Worktree
~/sites/opscentral-admin-review-feedback

## Base
origin/main @ e07c9fb

## Status
ready-for-integration

## PR
https://github.com/Atemndobs/ops-central/pull/275

## Source
Reported live by Atem (2026-07-15), two asks on the same screen:
1. "if I press the Pass button, nothing happens." Passing should advance to the next
   room, and the round pass/fail badges that made room status scannable were gone.
2. Finishing a job should show a success state and then load the next job awaiting
   review — the reviewer's actual task is clearing the queue.

Both are the same defect (the UI never confirms an action landed) at two altitudes,
in the same file, so they ship together.

## Root cause
`src/components/jobs/job-photos-review-client.tsx` — the Compare modal's verdict
chips only shifted to `bg-emerald-100 / bg-rose-100` (pastel tint) at `text-[11px]`
when active. The room list already used a solid `bg-emerald-500 text-white` for the
identical action, so the Compare modal had the weakest affordance of any surface in
the file. Nothing advanced, and no surface rendered per-room verdict state.

## What changed
Single file: `src/components/jobs/job-photos-review-client.tsx`.

- **New `RoomVerdictBadge` component** (next to `Pill`): round badge —
  filled emerald + check = pass, filled rose + cross = rework, hollow ring =
  unreviewed. Sizes sm/md/lg, optional `isCurrent` ring. Carries `role="img"` +
  `aria-label`.
- **New `ADVANCE_DELAY_MS = 450`** + `advanceTimerRef` + `clearAdvanceTimer()` +
  `closeCompare()` + `setCompareVerdict()`. Compare verdicts now record then advance
  to the next room. `nextCompareRoom` is captured at call time so the target resolves
  against the pre-verdict list (matters under the "Needs Review" filter, where the
  room leaves `visibleRows` the moment it's decided).
- **Timer safety**: cleared on manual nav (`openCompare`), Close (`closeCompare`),
  Escape, and unmount (new cleanup effect). Last room = no advance.
- **Compare header**: lg badge + room name, pass/rework/left counts, solid
  Pass/Rework buttons with icons + `aria-pressed`.
- **Room rail** (compare footer): one `sm` badge per room, horizontally scrollable,
  click to jump, current room ringed. Replaces the bare `1 / 10` counter (counter
  kept alongside).
- **Room rows** (desktop + mobile): badge added to the header; redundant
  `Pass` / `Needs Rework` text pills removed (badge + filled button already said it).
- **Decision screen + next-job handoff** (`DecisionResult`, `NEXT_JOB_DELAY_S = 4`):
  approve/reject now set `decisionResult` instead of only toasting. Overlay shows the
  xl badge, property, and room tally, then loads the next awaiting-approval job.
  Reads the existing `getReviewQueue({status:"awaiting_approval", limit:25})` —
  **gated on `decisionResult`** so it stays `"skip"` (zero read cost) until a job is
  actually finished. "Review next job" skips the wait, "stay here" cancels the
  countdown, "Back to queue" always present, empty queue → "Queue clear".
- **Route awareness** (`usePathname`): this component backs BOTH
  `/jobs/[id]/photos-review` and `/review/jobs/[id]/photos-review` (the latter via the
  66-line role-gate wrapper `review-photos-review-client.tsx`, which just renders this
  component). Next-job/queue links keep the reviewer in the route family they entered.
- **State-bleed fix** (reset effect on `[id]`): see Known risks.

## What main should test
1. `npm run lint && npm run build` clean.
2. Awaiting-Approval job → photo review → Compare → Pass: solid green fill, badge
   flips, rail fills, advances after ~0.45s. Rework: same in rose.
3. Pass then immediately Close / Prev / Escape → the queued advance must NOT fire.
4. Last room → verdict registers, no advance, no error.
5. Rail click jumps; current room ringed.
6. Read-only job → buttons disabled, no advance.

## Schema impact
none

## Convex impact
none — pure frontend, no queries/mutations touched. No deploy needed, no cleaners mirror.

## Commands main should run
- npm run lint
- npm run build

## Known risks
- low. Only surface touched is the photo-review workspace.
- **State bleed across jobs (fixed here, worth understanding).** Loading the next job
  is a same-route param change, so React keeps this component mounted and every piece
  of per-job state survives. `reviewByRoom` is keyed by normalized room NAME, so a
  "Kitchen" passed on job A would show as already-passed on job B. The existing
  snapshot loader can't cover it — it early-returns when a job has no saved snapshot,
  which is exactly the fresh-job case. Fixed with an explicit reset effect on `[id]`,
  declared BEFORE the snapshot loader so a real snapshot still wins on mount. If you
  add per-job state to this component, add it to that reset.
- Two behavioural changes are auto-advance (room, `ADVANCE_DELAY_MS`) and auto-load
  next job (`NEXT_JOB_DELAY_S`). Both are opt-out, not opt-in — clearing the queue is
  the reviewer's actual task. Neither is user-configurable yet; no evidence that's
  wanted, and the knobs are two constants at the top of the file.
- The next-job query is a real subscription, but `"skip"`-gated on `decisionResult`,
  so it costs nothing during the review itself and only opens once per finished job.
- Under the "Needs Review" filter the rail shrinks as rooms are decided (they leave
  `visibleRows`). Expected filter behaviour; the default "All" filter shows the full rail.

## Not verified
Automated browser preview blocked by Clerk auth (no test credentials). Needs a human
eyeball on the Compare modal.

## Environment note (bit me, may bite main)
This shell defaulted to **Node v16**, which breaks both eslint (`structuredClone is not
defined`) and the build (`next/font` → "Cannot find native binding" from an npm install
done under 16). Fix: `nvm use lts/jod` (Node 22) BEFORE `npm install`, and `rm -rf
node_modules && npm install` if an install already happened under 16. `package-lock.json`
is unaffected.

## Rollback plan
- git revert the merge commit. No schema, no backend, no data.
