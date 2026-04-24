# CountdownBadge

## Purpose
Live countdown to a job's scheduled start. Color shifts through three urgency tiers as the target approaches. Auto-hides for past timestamps.

## Inputs
- `targetTimestamp` — unix ms (nullable — renders `—` placeholder)
- `label` — optional, shown only in `normal` size; defaults to `cleaner.summary.timeToNextJob`
- `size` — `normal` | `compact`
- `href` — optional destination; if set, the whole badge is a link

## Tiers

| Tier | Trigger | Background | Foreground |
|---|---|---|---|
| `calm` | > 24h remaining | `color.cleaner.surface` | `color.cleaner.ink` |
| `soon` | 1–24h remaining | `color.cleaner.primary` | white |
| `urgent` | ≤ 1h remaining (or past) | destructive (red) | white |

See [`countdownTierColors`](../tokens/colors.ts).

## Formatting
- `> 1 day` → `"Nd Hh"` (e.g. `2d 5h`)
- `1h – 24h` → `"Hh Mm"` (e.g. `3h 45m`)
- `< 1h` → `"Mm' SS\""` (e.g. `12' 07"`)
- `≤ 0` → hide entirely (don't render anything)

## Visual
- Shape: `rounded-[10px]` (rounded button, not a pill)
- `compact` size — `px-3 py-2`, `13px` font, one-line
- `normal` size — `px-4 py-2`, two-line:
  - Top: `31px` bold display-ish (family = cleaner body, -0.03em tracking)
  - Bottom: `10px` label, muted when tier=calm, `white/90` otherwise

## Ticking
- Tick every **1000ms** when `remaining ≤ 1h`
- Tick every **30000ms** otherwise
- Stop ticking when target is null

## States
- `href` set → hover opacity 90% (normal) or 95% (compact); focus-visible outline
- No disabled state

## A11y
- When `href` is set: `aria-label` = the label text (since only the countdown is in the DOM)
- Screen readers announce the formatted countdown value; tick updates are not announced

## Reference
- Web: `CleanerCountdownBadge` in [src/components/cleaner/cleaner-ui.tsx](../../src/components/cleaner/cleaner-ui.tsx) (~line 154) + `useCountdown` hook (~line 122)
- Mobile: to be created at `components/cleaner/CountdownBadge.tsx` (Phase 3)
