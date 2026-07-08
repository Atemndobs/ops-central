# Mobile adapter — React Native StyleSheet

How the Expo app (`jna-cleaners-app`) will consume tokens from `opscentral-admin/design-system/tokens/` once Phase 3 lands.

> **Status:** deferred. The mobile app has extensive uncommitted work on `feature/convex-migration`. This adapter lands only after that branch merges to main.

---

## Metro watchFolders

The tokens folder lives outside the mobile app's repo root. Metro (Expo's bundler) must be told to watch it.

`jna-cleaners-app/metro.config.js`:

```js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Allow resolving files outside the project root (the design-system folder lives
// in ../opscentral-admin/design-system). Metro needs this in watchFolders AND
// the module path must be explicitly allowed via nodeModulesPaths.
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(__dirname, "../opscentral-admin/design-system"),
];

module.exports = config;
```

Verify with `npx expo start --clear` — a compile error mentioning the design-system path means Metro found it; a "module not found" means the watchFolder isn't picked up.

---

## Import path

Create a small re-export inside the mobile app so consumers don't need the ugly relative path:

```ts
// jna-cleaners-app/constants/designSystem.ts
export * from "../../opscentral-admin/design-system/tokens";
```

Then components import:

```ts
import { cleanerColors, statusPillColors, radii } from "@/constants/designSystem";
```

---

## Fallback if watchFolders breaks

If Metro/Expo has trouble with the out-of-tree path (e.g. in CI builds, EAS), the safer fallback is a `file:` dependency:

```json
// jna-cleaners-app/package.json
{
  "dependencies": {
    "@jna/design-tokens": "file:../opscentral-admin/design-system"
  }
}
```

and add a minimal `package.json` inside `opscentral-admin/design-system/` exposing `tokens/index.ts` as the main entry. Run `npm install` in `jna-cleaners-app` whenever tokens change (or symlink via `npm install --force`).

Prefer watchFolders first — fewer moving parts — and fall back to `file:` only if bundling breaks.

---

## Theme provider pattern

Extend the existing [`useThemedColors`](../../../jna-cleaners-app/hooks/useThemedColors.ts) (do NOT rip it out — other screens depend on it). Add a **cleaner overlay** that components in `(cleaner)/` opt into:

```ts
// jna-cleaners-app/hooks/useCleanerTheme.ts
import { useColorScheme } from "react-native";
import { cleanerColors, statusPillColors, countdownTierColors, radii, shadows } from "@/constants/designSystem";

export function useCleanerTheme() {
  const scheme = useColorScheme() ?? "light";
  return {
    mode: scheme,
    colors: cleanerColors[scheme],
    statusPill: statusPillColors[scheme],
    countdown: countdownTierColors[scheme],
    radii,
    shadow: shadows.cleanerCard[scheme],
  };
}
```

Cleaner primitives (`StatusPill.tsx`, `JobCard.tsx`, etc.) consume this hook; non-cleaner screens keep using `useThemedColors` and stay untouched.

---

## Shadow mapping

The CSS shadow `0 12px 30px -8px rgba(0,0,0,0.1)` can't translate 1:1 to RN's `shadowOffset` + `shadowRadius` + `elevation`. Use these equivalents:

```ts
// iOS
shadowColor: "#000",
shadowOffset: { width: 0, height: 12 },
shadowOpacity: 0.1,
shadowRadius: 30,

// Android
elevation: 8,
```

For the dark variant, raise `shadowOpacity` to `0.45` and use `elevation: 12`. The spread (`-8px` in CSS) can't be expressed — accept the small visual difference.

---

## Fonts

Google Fonts for the cleaner surface are loaded via Expo:

```ts
// jna-cleaners-app/app/_layout.tsx
import { useFonts, Spectral_700Bold } from "@expo-google-fonts/spectral";
import { Montserrat_500Medium, Montserrat_600SemiBold, Montserrat_700Bold } from "@expo-google-fonts/montserrat";
import { AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold } from "@expo-google-fonts/atkinson-hyperlegible";
```

Packages to install (Phase 3):

```
pnpm add @expo-google-fonts/spectral @expo-google-fonts/montserrat @expo-google-fonts/atkinson-hyperlegible
```

Hold the splash screen until `useFonts` resolves. Map font-family names in `components/cleaner/*` so switching fonts later is a tokens-only change.

---

## Checklist for Phase 3

1. Add `watchFolders` entry in `metro.config.js`
2. Create `constants/designSystem.ts` re-export
3. Install Google Font packages
4. Create `hooks/useCleanerTheme.ts`
5. Build primitives: `StatusPill`, `CountdownBadge`, `Section`, `Button`, `IconButton`, `JobCard`, `SummaryCard`
6. Rewire pilot screens: `app/(cleaner)/index.tsx`, `app/(cleaner)/job/[id].tsx`, `app/(cleaner)/active/[id].tsx`
7. Align i18n keys with web `cleaner.*` namespace
8. Visual parity check at 402px viewport vs PWA `/cleaner`
9. Spot-check non-cleaner screens for regressions
