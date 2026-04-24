/**
 * Feature flags — admin-configurable UI gates.
 *
 * Single-row-per-flag table. Adding a new flag requires three coordinated
 * changes:
 *   1. Add the literal to the `key` union in `convex/schema.ts` → featureFlags.
 *   2. Add the literal + default copy to `FLAG_METADATA` below.
 *   3. Read it client-side via `isFeatureEnabled` (see query below).
 *
 * Default behaviour when no row exists is OFF. Admins must explicitly turn
 * a flag on before any gated UI appears. This is the "ship dark, turn on
 * from admin when ready" pattern.
 */

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { requireAdmin } from "../lib/auth";

// ─────────────────────────────────────────────────────────────────────────────
// Validators (mirror schema.ts)
// ─────────────────────────────────────────────────────────────────────────────

const flagKeyValidator = v.union(
  v.literal("theme_switcher")
  // future flags:
  // v.literal("voice_messages"),
  // v.literal("ai_ops_assistant"),
);

export type FeatureFlagKey = "theme_switcher";

// ─────────────────────────────────────────────────────────────────────────────
// UI metadata — single source of truth for the admin Feature Flags card.
// ─────────────────────────────────────────────────────────────────────────────

type FlagMetadata = {
  key: FeatureFlagKey;
  label: string;
  description: string;
  /** What happens when this flag is OFF (informational copy for admins). */
  offBehaviour: string;
};

const FLAG_METADATA: Record<FeatureFlagKey, FlagMetadata> = {
  theme_switcher: {
    key: "theme_switcher",
    label: "Theme switcher (light / dark toggle)",
    description:
      "Shows a Sun/Moon toggle in the sidebar and header so users can switch " +
      "between light and dark mode.",
    offBehaviour:
      "Toggle is hidden and the app stays on whichever theme was last applied " +
      "(effectively locked to light for users who never flipped it).",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns whether a single flag is enabled. Defaults to FALSE when the row
 * doesn't exist so new flags ship dark. Intentionally public — client code
 * needs to read flags for the current user regardless of role.
 */
export const isFeatureEnabled = query({
  args: { key: flagKeyValidator },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    return row?.enabled ?? false;
  },
});

/**
 * Admin-facing list of every declared flag with its current state and the
 * copy the UI should render. Used by the Feature Flags settings card.
 */
export const listFeatureFlags = query({
  args: {},
  returns: v.array(
    v.object({
      key: flagKeyValidator,
      label: v.string(),
      description: v.string(),
      offBehaviour: v.string(),
      enabled: v.boolean(),
      updatedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query("featureFlags").collect();
    const byKey = new Map(rows.map((row) => [row.key, row]));

    const keys = Object.keys(FLAG_METADATA) as FeatureFlagKey[];
    return keys.map((key) => {
      const meta = FLAG_METADATA[key];
      const row = byKey.get(key);
      return {
        key: meta.key,
        label: meta.label,
        description: meta.description,
        offBehaviour: meta.offBehaviour,
        enabled: row?.enabled ?? false,
        updatedAt: row?.updatedAt,
      };
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flip a feature flag on or off. Admin-only. Creates the row on first write.
 */
export const setFeatureFlag = mutation({
  args: {
    key: flagKeyValidator,
    enabled: v.boolean(),
  },
  returns: v.object({
    key: flagKeyValidator,
    enabled: v.boolean(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const now = Date.now();

    const existing = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (existing) {
      if (existing.enabled === args.enabled) {
        return {
          key: existing.key,
          enabled: existing.enabled,
          updatedAt: existing.updatedAt,
        };
      }
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        updatedBy: admin._id,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("featureFlags", {
        key: args.key,
        enabled: args.enabled,
        updatedBy: admin._id,
        updatedAt: now,
        createdAt: now,
      });
    }

    return { key: args.key, enabled: args.enabled, updatedAt: now };
  },
});
