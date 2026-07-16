# Collapsible mobile bottom nav

**Date:** 2026-07-16
**Surface:** opscentral-admin web PWA (mobile viewport only)
**File:** `src/components/layout/mobile-bottom-nav.tsx`

## Problem

The floating bottom nav (`MobileBottomNav`) is pinned to `bottom-0` and floats on
top of page content (`pointer-events-none` container, `pointer-events-auto` pill).
On screens that render their own bottom action (e.g. the review flow's **Approve
Job** button), the nav's circular icons sit directly on top of that button, making
it hard or impossible to tap. Reported from the cleaner review/approve screen.

## Solution

Make the nav collapsible to the **right edge** via a chevron toggle. Navigation is
never fully removed: a small chevron tab always remains on the right so the user can
pull the icons back.

### Behavior

- **Expanded (default):** icon pill sits where it is today (centered). A chevron tab
  on the right edge shows `›` ("collapse to the right").
- **Tap `›`:** the icon pill slides off the right edge (`translateX` + fade, ~200ms)
  and becomes non-interactive (`pointer-events-none`, `aria-hidden`). Only the
  chevron tab remains, now showing `‹` ("pull me back").
- **Tap `‹`:** pill slides back in; chevron flips to `›`.

### Details

- **Persistence:** collapsed/expanded state stored in `localStorage`
  (`opscentral:navCollapsed`), default expanded. Hydrated in `useEffect` to avoid an
  SSR/hydration mismatch (accept a one-frame default-expanded flash). State persists
  across navigation so hiding it on one screen keeps it hidden until pulled back.
- **Unread signal while collapsed:** collapsing hides the messages unread badge, so
  the chevron tab shows a small dot when `unreadMessageCount > 0`, so unread messages
  aren't missed.
- **Accessibility:** the toggle is a real `<button>` with `aria-expanded` and an
  `aria-label` that flips between "Hide navigation" / "Show navigation". The `<nav>`
  landmark and existing per-icon labels are unchanged. When collapsed, the pill is
  `aria-hidden` and its links are removed from the tab order.
- **Motion:** transition respects `prefers-reduced-motion` (no slide for those users;
  state still toggles instantly).

## Scope / non-goals

- **One file.** No backend, no Convex, no schema, no change to the Expo mobile app.
- Not touching the desktop sidebar or the review-flow footer itself.
- No new dependency (chevron via existing `lucide-react`).

## Acceptance

1. On a mobile viewport, tapping `›` slides the icon pill off-right; the underlying
   bottom action (Approve Job) is fully tappable.
2. Tapping `‹` restores the pill.
3. Collapsed state survives navigation and reload.
4. A dot appears on the chevron tab when there are unread messages and the nav is
   collapsed.
5. `prefers-reduced-motion` users get an instant toggle, no slide.
