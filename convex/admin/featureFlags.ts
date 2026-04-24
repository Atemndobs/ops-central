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
  v.literal("theme_switcher"),
  v.literal("voice_messages"),
  v.literal("voice_audio_attachments"),
  v.literal("usage_dashboard")
  // future flags go here
);

export type FeatureFlagKey =
  | "theme_switcher"
  | "voice_messages"
  | "voice_audio_attachments"
  | "usage_dashboard";

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
  voice_messages: {
    key: "voice_messages",
    label: "Voice-to-text in messages composer",
    description:
      "Adds a microphone button to the messages composer. Tap to record, " +
      "release to transcribe via the selected AI provider and insert the " +
      "text into the message draft.",
    offBehaviour:
      "Mic button is hidden. Users can still type messages normally.",
  },
  voice_audio_attachments: {
    key: "voice_audio_attachments",
    label: "Retain voice recordings as playable attachments",
    description:
      "When a voice message is sent, keep the original audio clip and attach " +
      "it to the message as a playable bubble alongside the transcript. " +
      "Useful when tone matters or the transcript fails.",
    offBehaviour:
      "Audio is discarded immediately after transcription (privacy- and " +
      "cost-minimising default). Only the transcript text is sent.",
  },
  usage_dashboard: {
    key: "usage_dashboard",
    label: "Service usage & cost dashboard",
    description:
      "Exposes the Settings \u2192 Usage admin area showing request volume, " +
      "quota consumption, and estimated monthly spend across every tracked " +
      "external service (Gemini, Clerk, Hospitable, Resend, Convex).",
    offBehaviour:
      "The Usage tab and all service detail pages are hidden. Usage data " +
      "keeps recording in the background; only the admin UI disappears.",
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
