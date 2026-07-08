# Pattern: Ship Every New Feature Behind a Feature Flag

**Status:** Adopted
**Date:** 2026-04-24
**Scope:** All user-facing features in opscentral-admin + jna-cleaners-app

---

## The Rule

Every new user-facing feature ships behind a feature flag. The flag defaults
to **OFF**. An admin must explicitly enable it from **Settings → Integrations
→ Feature Flags** before the UI appears for any user.

While a feature is actively under development the team keeps the flag ON in
the dev/shared deployment so work-in-progress is visible. When the feature
lands in production, an admin makes the call about when (if ever) to expose
it to real users.

This applies to:
- New buttons, panels, modals
- New navigation items or routes
- New admin tools
- New integrations with external services
- New AI features

It does **not** apply to:
- Bug fixes on existing behaviour
- Backend-only changes with no user-visible surface
- Schema migrations (those have their own process — see
  `Docs/usage-tracking/ADR.md` for the data-model change pattern)

## Why

1. **Stable production.** A half-finished feature can ship alongside other
   work without affecting users.
2. **No regrets.** If something breaks after launch, an admin flips the flag
   off instantly — no hotfix deploy, no rollback.
3. **Controlled rollout.** Enable for the J&A team first, watch behaviour,
   then decide when to expose it more broadly.
4. **Discoverability.** Every gated feature is listed on one admin page —
   nobody forgets that a feature exists, and the copy explains what happens
   when it's off.

## How — the three-step recipe

### 1. Declare the flag

In `convex/schema.ts`, add the key to the `featureFlags.key` literal union:

```ts
const featureFlags = defineTable({
  key: v.union(
    v.literal("theme_switcher"),
    v.literal("voice_messages"),
    v.literal("my_new_feature")       // ← add here
  ),
  // ...
});
```

In `convex/admin/featureFlags.ts`:

```ts
const flagKeyValidator = v.union(
  v.literal("theme_switcher"),
  v.literal("voice_messages"),
  v.literal("my_new_feature")          // ← match here
);

export type FeatureFlagKey =
  | "theme_switcher"
  | "voice_messages"
  | "my_new_feature";                  // ← and in the TS type

const FLAG_METADATA: Record<FeatureFlagKey, FlagMetadata> = {
  // existing...
  my_new_feature: {
    key: "my_new_feature",
    label: "My new feature (one-sentence name)",
    description:
      "Two-sentence explanation of what this feature does for users, " +
      "plain language, no jargon.",
    offBehaviour:
      "Explain exactly what users see when the flag is OFF — so an admin " +
      "can predict the impact of flipping it.",
  },
};
```

Run `npx convex codegen` to regenerate types.

### 2. Gate the client render

In the component rendering the new feature, query the flag and branch on it:

```tsx
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

export function MyComponent() {
  const enabled = useQuery(api.admin.featureFlags.isFeatureEnabled, {
    key: "my_new_feature",
  });

  // ...

  return (
    <div>
      {/* existing UI */}
      {enabled ? <MyNewThing /> : null}
    </div>
  );
}
```

**Important:** treat `undefined` (loading state) the same as `false` — the
`enabled ? … : null` check does this automatically. Don't render the gated
UI during the loading window; users should only see it when we've confirmed
the flag is ON.

### 3. Note the flag in your PR description

Every PR that introduces a flag should say so in the description, with the
expected post-merge state (ON for dev, OFF for production). This lets
reviewers confirm the gating and lets operators know to flip the flag in
the right deployment if the feature is ready.

## Enabling a flag in dev vs production

Flags are per-deployment because they live in the Convex DB. We have one
effective-prod deployment right now (`usable-anaconda-394`, labelled as
"development" in Convex but serving ja-bs.com per the project notes in
CLAUDE.md), so enabling a flag there exposes it to real users.

Workflow while building a feature:
1. PR is open, flag exists in schema, gated code is in place.
2. Merge to main → Convex schema change deploys.
3. As admin on the app: Settings → Integrations → Feature Flags → toggle ON.
4. Test; if something's off, toggle OFF immediately.
5. Once the feature is production-ready, optionally remove the flag — but
   only if we're sure we'll never want to disable it again.

## When to retire a flag

A flag can be retired (feature becomes always-on) when all of:
- The feature has been live in production for ≥ 2 weeks with no incident
- Usage-tracking data (per `Docs/usage-tracking/ADR.md`) shows expected
  behaviour
- Nobody has raised a reason to keep it togglable (e.g. cost, experimental
  status, compliance)

Retiring a flag = one PR that removes the literal from the schema union,
removes the metadata entry, removes the `useQuery` gate, and unconditionally
renders the feature. Keep the commit focused — it's easier to revert if we
later regret killing the kill-switch.

## Current inventory

| Flag key | Feature | Introduced | Default |
|---|---|---|---|
| `theme_switcher` | Sun/Moon toggle in sidebar + header | 2026-04-24 | OFF |
| `voice_messages` | Mic button in conversation composer | 2026-04-24 | OFF |
| `voice_audio_attachments` | Retain voice recordings as playable attachments | 2026-04-24 | OFF |
| `usage_dashboard` | Settings → Usage admin area (Phase B of service-usage-tracking) | 2026-04-24 | OFF |

Keep this table in sync when adding or retiring flags.

## References

- `convex/schema.ts` — `featureFlags` table definition
- `convex/admin/featureFlags.ts` — registry + queries + admin mutation
- `src/components/settings/feature-flags-card.tsx` — admin UI
- `Docs/usage-tracking/ADR.md` — complementary pattern for data-model
  visibility; often paired with flags (flag gates the feature, usage tracking
  watches whether it's healthy once on)
