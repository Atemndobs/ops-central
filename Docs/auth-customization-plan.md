# Auth Page Customization Plan

**Created:** 2026-03-29
**Status:** Not started
**Branch:** fix/auth-and-inactive-icons

---

## Problem

The sign-in/sign-up pages are default Clerk widgets with zero ChezSoi branding. They feel like a borrowed third-party widget, not part of the application. Additionally, the `GlobalAuthHeader` renders redundant sign-in/sign-up buttons above the Clerk form on auth pages.

## Current State

- `src/app/sign-in/[[...sign-in]]/page.tsx` — bare `<SignIn />` centered on plain background
- `src/app/sign-up/[[...sign-up]]/page.tsx` — bare `<SignUp />` centered on plain background
- `src/components/layout/global-auth-header.tsx` — shows on auth pages (redundant)
- `src/app/layout.tsx` — `<ClerkProvider>` with no `appearance` prop
- `@clerk/themes` package installed but **never used**
- No auth-specific layout file
- No brand imagery on auth pages

## Approach: Two Phases

### Phase 1: Branded Shell + Clerk Appearance (do this first)

Keep Clerk's prebuilt `<SignIn />`/`<SignUp />` components but wrap them in a fully custom branded layout and apply Clerk's `appearance` API to match our design system. This is fast, low-risk, and gets us 90-95% of the way.

### Phase 2: Clerk Elements (only if Phase 1 feels limiting)

Migrate to Clerk Elements for total markup control — build the entire form with our own shadcn/ui components while Clerk handles auth state underneath. Bigger lift, usually not needed.

---

## Phase 1 Tasks

### Task 1: Hide GlobalAuthHeader on auth pages

**File:** `src/components/layout/global-auth-header.tsx`

Add `/sign-in` and `/sign-up` to the pathname check so the redundant header doesn't render on auth pages.

```tsx
if (
  pathname?.startsWith("/cleaner") ||
  pathname?.startsWith("/review") ||
  pathname?.startsWith("/sign-in") ||
  pathname?.startsWith("/sign-up")
) {
  return null;
}
```

### Task 2: Create auth layout with branded shell

**New file:** `src/app/(auth)/layout.tsx`
**Move:** sign-in and sign-up folders into `(auth)/` route group

The layout provides:
- Dark background enforced
- **Desktop:** Split layout — left brand panel + right auth widget panel
- **Mobile:** Stacked — logo/tagline on top, auth card below, full-width
- Left panel content:
  - ChezSoi logo
  - App name: "ChezSoi"
  - Tagline: "Operations Console" or "Property readiness starts here"
  - Subtle background pattern or gradient
- Right panel: Clerk widget, vertically centered

```
Desktop:
┌──────────────────┬──────────────────────┐
│                  │                      │
│   ChezSoi Logo   │   ┌──────────────┐  │
│                  │   │  Sign In      │  │
│   "Operations    │   │  [email]     │  │
│    Console"      │   │  [password]  │  │
│                  │   │  [Continue]  │  │
│   Property       │   │  — or —      │  │
│   readiness      │   │  [Google]    │  │
│   starts here    │   └──────────────┘  │
│                  │                      │
│  (dark panel)    │   (themed widget)    │
└──────────────────┴──────────────────────┘

Mobile:
┌────────────────────┐
│   ChezSoi Logo     │
│   Operations       │
│   Console          │
│                    │
│ ┌────────────────┐ │
│ │  Sign In       │ │
│ │  [email]       │ │
│ │  [password]    │ │
│ │  [Continue]    │ │
│ └────────────────┘ │
└────────────────────┘
```

### Task 3: Apply Clerk `appearance` prop

**File:** Either on `<ClerkProvider>` in `src/app/layout.tsx` or directly on `<SignIn />`/`<SignUp />`

Map Clerk's internal styling to our CSS custom properties:

- **Background/card:** Use `var(--card)` / `var(--card-foreground)`
- **Primary button:** Use `var(--primary)` / `var(--primary-foreground)`
- **Inputs:** Use `var(--input)`, `var(--border)`, `var(--foreground)`
- **Border radius:** Use `var(--radius)` (0.75rem)
- **Font:** Geist Sans (`var(--font-geist-sans)`)
- **Remove Clerk branding/footer** via `appearance.layout.showOptionalFields: false` and element overrides
- **Force dark color scheme** on the Clerk components

Key appearance areas:
```ts
appearance={{
  variables: {
    colorPrimary: "...",       // match --primary
    colorBackground: "...",    // match --card
    colorText: "...",          // match --foreground
    colorInputBackground: "...", // match --input
    borderRadius: "0.75rem",
    fontFamily: "var(--font-geist-sans)",
  },
  elements: {
    card: "shadow-none bg-transparent",
    formButtonPrimary: "...",
    formFieldInput: "...",
    footerAction: "...",
    // ... more element overrides
  },
}}
```

### Task 4: Add ChezSoi logo to public/

**New file:** `public/chezsoi-logo.svg` (or .png)

Source: Either extract from the favicon URL already in layout metadata (`chezsoistays.com/wp-content/uploads/2026/02/chezsoi_favicon@2x.png`) or create/obtain a proper logo asset.

Use in:
- Auth layout brand panel (large)
- Optionally as `appearance.layout.logoImageUrl` on Clerk component

### Task 5: Simplify sign-in/sign-up page components

**Files:**
- `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`
- `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx`

Remove the centering wrapper (layout handles it). Just render the Clerk component with routing props:

```tsx
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return <SignIn signUpUrl="/sign-up" fallbackRedirectUrl="/" />;
}
```

### Task 6: Responsive + dark mode QA

Verify:
- Desktop split layout renders correctly
- Mobile stacks properly
- Dark mode is enforced and consistent
- Clerk widget matches app design tokens
- No flash of unstyled content
- GlobalAuthHeader is hidden on auth routes

---

## Files Changed/Created

| Action | File |
|--------|------|
| Edit | `src/components/layout/global-auth-header.tsx` |
| Create | `src/app/(auth)/layout.tsx` |
| Move | `src/app/sign-in/` → `src/app/(auth)/sign-in/` |
| Move | `src/app/sign-up/` → `src/app/(auth)/sign-up/` |
| Edit | `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx` |
| Edit | `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` |
| Edit | `src/app/layout.tsx` (appearance prop on ClerkProvider) |
| Create | `public/chezsoi-logo.svg` or `.png` |

## Risk Assessment

**Low risk.** No business logic changes. Auth flow stays identical — we're only changing visual presentation. The Clerk `appearance` API is stable and well-documented. Route group `(auth)` doesn't change URL paths.

## References

- Clerk appearance customization: https://clerk.com/docs/customization/overview
- Clerk Elements (Phase 2 if needed): https://clerk.com/docs/customization/elements
- Clerk themes: https://clerk.com/docs/customization/themes
