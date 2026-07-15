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
Reported live by Atem (2026-07-15): "if I press the Pass button, nothing happens."
Passing should advance to the next room, and the round pass/fail status badges that
used to make room status scannable were gone.

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
- The one behavioural change is auto-advance. If reviewers turn out to want to linger
  on a room after deciding, the knob is `ADVANCE_DELAY_MS` (or gate the advance behind
  a preference). Deliberately not made configurable yet — no evidence it's wanted.
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
