# Web adapter — Tailwind + CSS variables

How the web app (`opscentral-admin`) consumes tokens from [`../tokens/`](../tokens/).

---

## Import path

```ts
import { cleanerColors, radii, shadows } from "@/design-system/tokens";
```

The `@/design-system` alias is already provided by the existing `@/*` → `src/*` tsconfig path **only if** the design-system folder lives under `src/`. Since it lives at the package root (`opscentral-admin/design-system/`), add a new alias:

```json
// tsconfig.json — compilerOptions.paths
{
  "@/design-system/*": ["./design-system/*"]
}
```

If the alias is impractical, use a relative import: `../../design-system/tokens` from most consumers.

---

## CSS variables generation

CSS variables in [`src/app/globals.css`](../../src/app/globals.css) are the runtime source for both the admin shadcn theme AND the cleaner-theme overlay. To keep them in sync with `tokens/`:

1. A Node script at `scripts/sync-tokens.ts` reads `design-system/tokens/` and emits `src/app/design-tokens.generated.css` — a file containing only the `--cleaner-*` and `--admin-*` variable blocks (no other CSS).
2. `globals.css` `@import`s that generated file near the top (before `:root` overrides that reference them).
3. The generated file is **committed to git** (like Prisma client). CI verifies it's up to date by running the sync and diffing.

Hand-written portions of `globals.css` (the non-token CSS — layer/utility definitions, gradients, input-zoom guards) stay unchanged. Only the variable declarations are generated.

### Sync script contract

```bash
pnpm sync-tokens          # regenerate design-tokens.generated.css
pnpm sync-tokens --check  # exit nonzero if out of sync (for CI)
```

See [`../../scripts/sync-tokens.ts`](../../scripts/sync-tokens.ts) for the implementation once Phase 2 lands.

---

## Tailwind configuration

Tailwind v4 reads CSS variables directly, so token → utility class wiring is mostly automatic via `@import "tailwindcss"` + CSS vars. Where we need explicit mappings (e.g. `bg-cleaner-primary` instead of the arbitrary `bg-[var(--cleaner-primary)]`), extend the theme in `globals.css` via the `@theme` directive:

```css
@theme {
  --color-cleaner-primary: var(--cleaner-primary);
  --color-cleaner-primary-soft: var(--cleaner-primary-soft);
  --radius-card: 24px;
  --radius-button: 10px;
}
```

This step is optional — existing cleaner components use arbitrary-value Tailwind (`bg-[var(--cleaner-primary)]`) and don't require a `@theme` registration.

---

## Consuming tokens in TypeScript

Components that need computed values (e.g. gradients, style-in-JS) import the constants directly:

```tsx
import { statusPillColors, radii } from "@/design-system/tokens";

function StatusPill({ appearance, mode }: Props) {
  const c = statusPillColors[mode][appearance];
  return (
    <span style={{ backgroundColor: c.bg, color: c.fg, borderRadius: radii.pill }}>
      {label}
    </span>
  );
}
```

Prefer Tailwind utility classes for simple cases; drop to JS-imported tokens only when the value is computed at runtime or when the class system can't express it (e.g. interpolated gradients).

---

## Migration path for existing `globals.css`

The current `globals.css` hand-codes hex values for `--cleaner-*`. Phase 2 replaces those with either (a) generated values from the sync script or (b) a hand-written `@import` of a minimal generated file. Either way:

- **Don't delete `globals.css`** — it still owns the Tailwind layer setup, utility classes (`.cleaner-card`, `.cleaner-eyebrow`, etc.), and `:root` / `.dark` scoping.
- **Do** replace the raw hex values with references to generated variables.
- **Verify** `/cleaner` renders pixel-identically before and after.
