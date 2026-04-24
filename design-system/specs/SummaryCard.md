# SummaryCard

## Purpose
Hero card on the cleaner home screen. Greets the user, previews the next job countdown, and links to four key sub-views with unread counts.

## Inputs
- `userName` — optional string (shown in greeting; empty string OK)
- `nextJobs`, `inReview`, `unreadMessages`, `updates` — non-negative integers (used as badge counts)
- `nextJobAt` — unix ms for the [CountdownBadge](CountdownBadge.md)
- `nextJobHref` — optional link for the countdown
- `onToggle` — optional collapse handler

## Visual
- Outer: `rounded-[18px]`, **linear-gradient 135°** from `cleaner.primary` → `cleaner.primary-soft`, white text, `shadow.cleanerCard`
- Padding: `16px` horizontal, `16px` vertical
- Two rows:

### Row 1 — header
- Left: greeting text in `cleaner-display` (Spectral 700, -0.03em, tight leading), white
  - Content example: "Good morning, Maria" (the `cleaner.summary.greeting` key handles time-of-day + name)
- Right: collapse icon button (`Minimize2`), 16×16 icon, subtle `hover:bg-white/10`

### Row 2 — content
- Left: [CountdownBadge](CountdownBadge.md) (normal size, linked to `nextJobHref`)
- Right: 4-column grid, gap 8:
  - Each cell: `<Link>` to sub-view, flex-column center, `rounded-xl px-1 py-1`, hover `bg-white/10`
  - Icon circle: 28×28, `bg-white/15`, inner icon 14×14
  - Unread badge (if count > 0): top-right `-1px -1px` offset, destructive red circle, 16×16, `px-1`, `8px` bold white, "9+" if >9
  - Label under icon: 8px white/90 (yes, really that small)

## Grid items
| Key | Icon | Href |
|---|---|---|
| nextJobs | `ClipboardList` | `/cleaner` |
| inReview | `Info` | `/cleaner/history` |
| messages | `MessageCircle` | `/cleaner/messages` |
| updates | `RefreshCw` | `/cleaner/notifications` |

Labels come from i18n (`cleaner.summary.nextJobs`, `cleaner.summary.inReview`, `cleaner.summary.messages`, `cleaner.summary.update`).

## States
- Collapsed (managed by parent): when collapsed, parent renders a compact variant — not part of this spec
- Hover per grid cell — `bg-white/10`, focus-visible shows same tint

## A11y
- Each grid link has an `aria-label` set to its label text
- Collapse button: `aria-label` from `cleaner.summary.collapseSummary`

## Reference
- Web: `CleanerSummaryCard` in [src/components/cleaner/cleaner-ui.tsx](../../src/components/cleaner/cleaner-ui.tsx) (~line 413)
- Mobile: to be created at `components/cleaner/SummaryCard.tsx` (Phase 3) — currently absent on mobile home
