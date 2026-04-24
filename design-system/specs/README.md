# Component Specs

Language-neutral contracts for every shared cleaner primitive. Web and mobile implement to these specs — the implementations differ, the visuals and behavior do not.

## How to read a spec

Every spec has the same sections:

- **Purpose** — one sentence on what the component is for
- **Props / Inputs** — contract (not TypeScript — semantic names + types)
- **Variants** — named appearance/behavior modes
- **States** — hover, active, pressed, disabled, focus
- **Visual** — size, radius, padding, color tokens used
- **A11y** — labels, roles, focus order
- **Reference** — which current implementations to study

Token references (e.g. `color.primary`, `radii.card`) always resolve to values in [`../tokens/`](../tokens/).

## Specs index

### Primitives
- [StatusPill](StatusPill.md) — 4-state job status indicator
- [CountdownBadge](CountdownBadge.md) — countdown-to-start timer with urgency tiers
- [Button](Button.md) — primary / outline / ghost / danger
- [Badge](Badge.md) — chips for bedrooms/bathrooms/guests and flags
- [IconButton](IconButton.md) — circular tool/nav buttons with badge counts
- [Section](Section.md) — titled card container (24px radius)

### Composites
- [JobCard](JobCard.md) — job row with address, time, chips, countdown, action
- [SummaryCard](SummaryCard.md) — home-screen greeting + 4-stat grid

### Layout
- [layout/MobileShell](layout/MobileShell.md) — header + scroll body + bottom nav + safe areas
- [layout/BottomNav](layout/BottomNav.md) — 4-column tab bar contract
