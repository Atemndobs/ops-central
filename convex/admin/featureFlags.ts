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
  v.literal("messages_granola_chips"),
  v.literal("messages_granola_composer"),
  v.literal("voice_audio_attachments"),
  v.literal("usage_dashboard"),
  v.literal("video_support"),
  v.literal("owner_show_mgmt_fee"),
  v.literal("owner_show_payout"),
  v.literal("owner_overview_auto_drafts"),
  v.literal("reviewsAiReply"),
  v.literal("owner_show_gross_revenue"),
  v.literal("owner_show_statements"),
  v.literal("whatsapp_messaging")
  // future flags go here
);

export type FeatureFlagKey =
  | "theme_switcher"
  | "voice_messages"
  | "messages_granola_chips"
  | "messages_granola_composer"
  | "voice_audio_attachments"
  | "usage_dashboard"
  | "video_support"
  | "owner_show_mgmt_fee"
  | "owner_show_payout"
  | "owner_overview_auto_drafts"
  | "reviewsAiReply"
  | "owner_show_gross_revenue"
  | "owner_show_statements"
  | "whatsapp_messaging";

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
  messages_granola_chips: {
    key: "messages_granola_chips",
    label: "Granola context chips in messages",
    description:
      "Enables the Granola context chips UI in message composition flows " +
      "to insert recent meeting context quickly.",
    offBehaviour:
      "Granola chips are hidden from the messages composer. Core messaging " +
      "flows continue without contextual chip suggestions.",
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
  video_support: {
    key: "video_support",
    label: "Video support (record & playback)",
    description:
      "Enables the cleaner-side \u201cRecord Video\u201d button on incident " +
      "reports and renders video tiles in admin galleries (incident drawer, " +
      "job photos review lightbox). Requires both this flag AND the " +
      "build-time `NEXT_PUBLIC_ENABLE_VIDEO` env-var to be on \u2014 the env " +
      "var is the hard kill-switch for the bundle, this flag is the runtime " +
      "toggle. See Docs/video-support/ for full design.",
    offBehaviour:
      "Video tiles are filtered out of every gallery, the inline video " +
      "player shows a \u201cVideo disabled\u201d placeholder, and the " +
      "mobile cleaner app hides the \u201cRecord Video\u201d button. " +
      "Existing video rows in the database stay intact \u2014 turning the " +
      "flag back on makes them visible again.",
  },
  messages_granola_composer: {
    key: "messages_granola_composer",
    label: "Granola-style messages composer (pilot)",
    description:
      "Replaces the legacy messages composer with the Granola-inspired " +
      "pill tile: mic\u2194send swap in a single right-most slot, unified " +
      "attach popover (photo / file / camera / video), quick-action chips " +
      "above the input, and Cmd/Ctrl+Enter to send (Enter inserts a " +
      "newline). Behaviour is otherwise identical \u2014 same Convex " +
      "mutations, same voice/video pipelines. See Docs/messages-redesign/" +
      "2026-04-28-granola-inspired-chat-input.md.",
    offBehaviour:
      "Composer renders the current side-by-side mic + send layout with " +
      "Enter-to-send keyboard contract. No chips, no expand-to-fullscreen.",
  },
  owner_show_mgmt_fee: {
    key: "owner_show_mgmt_fee",
    label: "Owner portal: show management fee inline",
    description:
      "Reveals the management-fee row inside the MonthSummary card on the " +
      "owner per-property page (the small “Your payout” block). " +
      "When on, owners see Gross → NOI → Mgmt fee (×%) → " +
      "Payout broken out inline. When off, only Gross and final Payout " +
      "appear on the dashboard — the full fee breakdown still lives on " +
      "the issued PDF statement and the detailed statement page. Used to A/B " +
      "whether transparency on the dashboard helps or hurts owner reception.",
    offBehaviour:
      "Mgmt fee row is hidden from the per-property summary card. The fee " +
      "still computes and still appears on the statement detail page + PDF " +
      "— only the at-a-glance card hides it.",
  },
  owner_show_payout: {
    key: "owner_show_payout",
    label: "Owner portal: show payout inline",
    description:
      "Reveals the “Your payout” tile inside the MonthSummary " +
      "card on the owner per-property page. Defaults ON since the payout " +
      "is the headline owner-facing number. Toggle OFF to demo a " +
      "“gross + fee only” view (e.g. when comparing landlord-side " +
      "vs operator-side numbers in a pitch).",
    offBehaviour:
      "Payout tile is hidden from the per-property summary card. The " +
      "payout still computes and still appears on the statement detail " +
      "page + PDF — only the at-a-glance card hides it.",
  },
  owner_overview_auto_drafts: {
    key: "owner_overview_auto_drafts",
    label: "Admin Owner Overview: auto-create monthly drafts",
    description:
      "When ON, a monthly cron runs on the 1st of each month and creates " +
      "a DRAFT statement for every (active owner, property, previous " +
      "month) pair that doesn't already have one. Admins still have to " +
      "explicitly Issue from the editor — this just removes the manual " +
      "step of typing in a period to materialize the draft.",
    offBehaviour:
      "Cron is inert. Admins must open the property split view and click " +
      "Save draft to create the first statement row for any period.",
  },
  reviewsAiReply: {
    key: "reviewsAiReply",
    label: "AI review-response inbox",
    description:
      "Adds a top-level Reviews inbox and a Reviews section on property " +
      "detail. Guest reviews synced from Hospitable get an AI-drafted " +
      "reply that an admin or property_ops user edits and approves " +
      "before it's published back to Airbnb.",
    offBehaviour:
      "Reviews nav item and property-detail Reviews section are hidden. " +
      "Ingestion and drafting still run in the background regardless of " +
      "this flag — it only gates the UI.",
  },
  owner_show_gross_revenue: {
    key: "owner_show_gross_revenue",
    label: "Owner portal: show gross revenue",
    description:
      "Shows the gross-revenue figure in the owner portal (per-property " +
      "cards, tables, and month summary).",
    offBehaviour:
      "Gross-revenue numbers are hidden across the owner portal. Owners " +
      "still see their jobs and non-financial info.",
  },
  owner_show_statements: {
    key: "owner_show_statements",
    label: "Owner portal: show statements",
    description:
      "Exposes the owner statements list and the statement-detail screen " +
      "(monthly financial statements).",
    offBehaviour:
      "The statements list and statement-detail screens are hidden; deep " +
      "links render a neutral placeholder. Statement data is untouched.",
  },
  whatsapp_messaging: {
    key: "whatsapp_messaging",
    label: "WhatsApp messaging lane",
    description:
      "Enables the per-cleaner WhatsApp channel in the job Communications " +
      "panel — WhatsApp lane, invite links, and inbound/outbound WhatsApp " +
      "messages.",
    offBehaviour:
      "The WhatsApp lane and invite links are hidden; only the internal " +
      "team thread shows. Backend WhatsApp processing is unaffected — this " +
      "gates the UI only.",
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
