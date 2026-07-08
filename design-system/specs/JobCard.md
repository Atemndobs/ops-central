# JobCard

## Purpose
Primary row in the cleaner's job list. Summarizes a single job: where it is, when it's scheduled, property attributes, current status, and a tap target to the detail view.

## Inputs
- `propertyName` — string
- `address`, `city` — optional strings (primary display is `address`)
- `guestCount`, `bedrooms`, `bathrooms` — optional numbers (0 hides chip)
- `partyRiskFlag`, `lateCheckout`, `earlyCheckin` — booleans (the last two may also be *derived* from `checkInAt`/`checkOutAt` vs the 10am/4pm standard window in the property's timezone)
- `scheduledAt`, `scheduledEndAt` — unix ms; drives the time range and countdown
- `checkInAt`, `checkOutAt`, `timezone` — for risk derivation and labels
- `notes` — freeform string shown via InfoRow (with legacy-line stripping; see Notes section)
- `appearance` — `StatusPill` appearance
- `statusLabel` — localized status text for the pill
- `detailHref` — full-card tap target
- `propertyHref` — optional; if set, property-name row becomes a link
- `actionHref`, `actionLabel` — optional; renders a primary action button (e.g. "Start")

## Visual
- Outer: `cleaner-card` (radius `24px`, 1px border, `shadow.cleanerCard`), padding `16px`
- When `appearance = open`: border becomes `3px solid color.cleaner.primary` (signals new/actionable)
- Hover: `bg-[var(--muted)]/40` tint (desktop only; mobile ignores)
- Full-card `<Link>` overlay at z-0 makes the entire card tappable; interactive children (maps link, property link, action button, countdown) sit at z-10 to stay tappable

## Layout (top to bottom)
1. **Title row** (flex between):
   - Left: if `address`, render as external Google Maps link with `MapPin` icon — cleaner-display `18px` ink text; else "No address" fallback
   - Right: [StatusPill](StatusPill.md)
2. **Time row** — `Clock` icon + time range + `·` + short date; muted text, `13px`
3. **Meta rows** — each is `Icon + text`, 13px, muted icon:
   - Property name row (linked if `propertyHref`) with `ChevronRight` trailing affordance
   - Info row with derived risk lines + notes (multi-line, whitespace-pre)
4. **Footer row** (chips + action):
   - Left (flex-1, nowrap, gap 6): Bedroom chip, Bathroom chip, Guest chip — each `bg-muted`, `11px`, icon+count, truncates
   - Middle (shrink-0): `<CountdownBadge size=compact>`
   - Right (shrink-0): optional primary action button

## Chip spec
- `rounded-lg bg-[var(--muted)] px-2 py-1.5 text-[11px] font-medium text-ink`
- Bedroom/bathroom chips are `<Link>` to `detailHref`; guest chip is static `<span>`
- Icons: `BedDouble` (12×12), `Bath` (12×12), `Users` (12×12)

## Derived timing risks
- `lateCheckout` = `checkOutAt` > 10:00 AM in the property timezone
- `earlyCheckin` = `checkInAt` < 4:00 PM in the property timezone
- Rendered as full sentences inside the Info row (localized)

## Notes handling
Legacy Hospitable-sync lines are stripped from `notes` to avoid duplication when a structured flag already renders them:
- `N guest(s)` lines — always stripped (chip shows the count)
- `Late checkout expected.` — stripped iff `lateCheckout` flag is true
- `Early check-in expected.` — stripped iff `earlyCheckin` is true
- `Party risk flagged…` — stripped iff `partyRiskFlag` is true

## A11y
- Full-card link's `aria-label` = `address` if present, else `propertyName`
- Focus-visible outline on card overlay: `2px color.cleaner.primary`
- Chip links have their own `aria-label` (e.g. "2 bedrooms")
- External maps link: `target="_blank"` + `rel="noopener noreferrer"`

## Reference
- Web: `CleanerJobCard` in [src/components/cleaner/cleaner-ui.tsx](../../src/components/cleaner/cleaner-ui.tsx) (~line 516)
- Mobile: to be created at `components/cleaner/JobCard.tsx` (Phase 3) — replaces existing `components/JobCard.tsx`
