/**
 * AI Provider Settings — queries and mutations
 *
 * Handles the single-row-per-feature rows in the `aiProviderSettings` table.
 *
 * Read path:
 *   - `getVoiceProvider`  — public query. Returns the currently selected
 *                           provider for voice transcription, falling back
 *                           to the registry default if no row exists yet.
 *   - `listVoiceProviders` — public query returning UI-ready metadata for
 *                            the provider picker (label, cost copy, whether
 *                            the backing env var is configured).
 *
 * Write path:
 *   - `setVoiceProvider`  — admin-only mutation. Rejects if the env var
 *                           for the chosen provider isn't set on the server
 *                           so admins don't footgun a dead provider live.
 */

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { requireAdmin } from "../lib/auth";
import {
  DEFAULT_VOICE_PROVIDER,
  VOICE_PROVIDERS,
  VOICE_PROVIDER_KEYS,
  isVoiceProviderConfigured,
  type VoiceProviderKey,
} from "./providers";

// ─────────────────────────────────────────────────────────────────────────────
// Reusable validator — must mirror the literal union in schema.ts
// ─────────────────────────────────────────────────────────────────────────────

const voiceProviderKeyValidator = v.union(
  v.literal("gemini-flash"),
  v.literal("groq-whisper-turbo"),
  v.literal("openai-whisper")
);

// ─────────────────────────────────────────────────────────────────────────────
// UI metadata — single source of truth for labels and cost copy shown in
// the admin settings page. Kept alongside the registry so changes stay in
// one place.
// ─────────────────────────────────────────────────────────────────────────────

type ProviderMetadata = {
  key: VoiceProviderKey;
  label: string;
  costLabel: string;
  description: string;
};

const PROVIDER_METADATA: Record<VoiceProviderKey, ProviderMetadata> = {
  "gemini-flash": {
    key: "gemini-flash",
    label: "Gemini 2.5 Flash",
    costLabel: "$0 (within free-tier quota)",
    description:
      "Default. Uses the shared GOOGLE_GENERATIVE_AI_API_KEY. Billing is " +
      "hard-capped as a safety net; our usage pattern stays within the " +
      "free-tier quota (~15 req/min, ~1500 req/day) so no spend is expected.",
  },
  "groq-whisper-turbo": {
    key: "groq-whisper-turbo",
    label: "Groq — Whisper v3 Turbo",
    costLabel: "~$0.0007 / min",
    description:
      "Fastest latency, cheapest paid option. Whisper-grade accuracy, " +
      "strong bilingual (en/es) support.",
  },
  "openai-whisper": {
    key: "openai-whisper",
    label: "OpenAI — Whisper",
    costLabel: "$0.006 / min",
    description:
      "Reliability fallback. Gold-standard multilingual transcription.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the currently selected voice-transcription provider key, falling
 * back to the default when no row exists yet. Intentionally public (any
 * signed-in user's client may read this to know which provider is active).
 */
export const getVoiceProvider = query({
  args: {},
  returns: v.object({
    providerKey: voiceProviderKeyValidator,
    updatedAt: v.optional(v.number()),
    isDefault: v.boolean(),
  }),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("aiProviderSettings")
      .withIndex("by_feature", (q) => q.eq("feature", "voice_transcription"))
      .unique();

    if (!row) {
      return {
        providerKey: DEFAULT_VOICE_PROVIDER,
        updatedAt: undefined,
        isDefault: true,
      };
    }

    return {
      providerKey: row.providerKey,
      updatedAt: row.updatedAt,
      isDefault: false,
    };
  },
});

/**
 * Returns the UI-ready list of providers for the admin settings picker:
 * label, cost copy, whether the env var is configured, and which key is
 * currently active.
 */
export const listVoiceProviders = query({
  args: {},
  returns: v.object({
    activeKey: voiceProviderKeyValidator,
    providers: v.array(
      v.object({
        key: voiceProviderKeyValidator,
        label: v.string(),
        costLabel: v.string(),
        description: v.string(),
        envVar: v.string(),
        isConfigured: v.boolean(),
      })
    ),
  }),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("aiProviderSettings")
      .withIndex("by_feature", (q) => q.eq("feature", "voice_transcription"))
      .unique();

    const activeKey: VoiceProviderKey = row?.providerKey ?? DEFAULT_VOICE_PROVIDER;

    const providers = VOICE_PROVIDER_KEYS.map((key) => {
      const meta = PROVIDER_METADATA[key];
      const registryEntry = VOICE_PROVIDERS[key];
      return {
        key: meta.key,
        label: meta.label,
        costLabel: meta.costLabel,
        description: meta.description,
        envVar: registryEntry.envVar,
        isConfigured: isVoiceProviderConfigured(key),
      };
    });

    return { activeKey, providers };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Switch the active voice-transcription provider. Admin-only.
 *
 * Refuses the change if the env var backing the chosen provider isn't set,
 * to prevent silently selecting a dead provider that would break transcription
 * for all users.
 */
export const setVoiceProvider = mutation({
  args: {
    providerKey: voiceProviderKeyValidator,
  },
  returns: v.object({
    providerKey: voiceProviderKeyValidator,
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    if (!isVoiceProviderConfigured(args.providerKey)) {
      const envVar = VOICE_PROVIDERS[args.providerKey].envVar;
      throw new Error(
        `Cannot select "${args.providerKey}": the "${envVar}" env var is not ` +
          `configured on the Convex deployment. Set it in the Convex dashboard first.`
      );
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("aiProviderSettings")
      .withIndex("by_feature", (q) => q.eq("feature", "voice_transcription"))
      .unique();

    if (existing) {
      // No-op early return if nothing changed — avoids spamming the audit trail.
      if (existing.providerKey === args.providerKey) {
        return { providerKey: existing.providerKey, updatedAt: existing.updatedAt };
      }
      await ctx.db.patch(existing._id, {
        providerKey: args.providerKey,
        updatedBy: admin._id,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("aiProviderSettings", {
        feature: "voice_transcription",
        providerKey: args.providerKey,
        updatedBy: admin._id,
        updatedAt: now,
        createdAt: now,
      });
    }

    return { providerKey: args.providerKey, updatedAt: now };
  },
});
