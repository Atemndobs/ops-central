# Section

## Purpose
Titled card container used to group related content on a cleaner page. The signature "24px radius + soft shadow + white surface" look.

## Inputs
- `eyebrow` — optional, small uppercase label above the title
- `title` — optional, display-font card title
- `children` — body content

## Visual
- Wraps content in `cleaner-card` (radius `24px`, 1px border, `shadow.cleanerCard`)
- Padding: `16px` all sides (`p-4`)
- If `eyebrow` present: `cleaner-eyebrow` style (10px, mono, uppercase, 0.18em, muted)
- If `title` present: `cleaner-card-title` (Spectral 700, `1.6rem`, -0.03em, ink)
- If either header is present, children get `margin-top: 16px`

## Variants
None — single default. Compose multiple `Section`s for complex pages.

## States
Static container, no interactive states. Interactive children manage their own.

## A11y
- The `<section>` landmark is implicit
- If `title` is set, it's an `<h2>` — ensure consistent heading hierarchy on the page
- If no `title`, this is a decorative wrapper and shouldn't introduce a heading

## Reference
- Web: `CleanerSection` in [src/components/cleaner/cleaner-ui.tsx](../../src/components/cleaner/cleaner-ui.tsx) (~line 323)
- Related: `CleanerAccessSection` (line 746) composes three Sections for access notes
- Mobile: to be created at `components/cleaner/Section.tsx` (Phase 3)
