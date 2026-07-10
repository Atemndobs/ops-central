/**
 * App Settings — org-wide singleton preferences.
 *
 * Currently holds the display timezone the whole admin app renders dates and
 * times in. "App operated in Dallas" → default America/Chicago, so every
 * viewer (even one in another country) sees Dallas time unless an admin
 * changes it here.
 *
 * Read path:
 *   - `getTimezone` — public query. Returns the configured IANA timezone,
 *                     falling back to the default when no row exists yet.
 * Write path:
 *   - `setTimezone` — admin-only. Validates the identifier is a real IANA zone
 *                     before saving so nobody can wedge the app with a typo.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { DEFAULT_REWORK_DEADLINE_MINUTES } from "./lib/reworkDeadline";
import {
  DEFAULT_STORAGE_PROVIDER,
  getConfigForProviderOrNull,
  normalizeStorageProvider,
  type StorageProvider,
} from "./lib/externalStorage";

// "App operated in Dallas" — Central Time is the default display zone.
export const DEFAULT_TIMEZONE = "America/Chicago";

// Validator for the active object-storage backend.
const storageProviderValidator = v.union(
  v.literal("b2"),
  v.literal("minio"),
);

/**
 * UI-ready metadata for each selectable storage backend. `isConfigured` is
 * computed at query time from the deployment's env vars.
 */
const STORAGE_PROVIDERS: ReadonlyArray<{
  key: StorageProvider;
  label: string;
  description: string;
  costLabel: string;
  envVar: string;
}> = [
  {
    key: "b2",
    label: "Backblaze B2",
    description:
      "Cloud object storage. Metered — subject to Backblaze daily download / Class-B transaction caps.",
    costLabel: "metered",
    envVar: "B2_BUCKET · B2_S3_ENDPOINT · B2_KEY_ID · B2_APPLICATION_KEY",
  },
  {
    key: "minio",
    label: "Self-hosted MinIO",
    description:
      "Homelab S3 — uncapped, but must be publicly reachable for cleaners' phones to load media in the field.",
    costLabel: "self-hosted",
    envVar: "MINIO_BUCKET · MINIO_ENDPOINT · MINIO_ACCESS_KEY · MINIO_SECRET_KEY",
  },
];

/**
 * Resolve the active storage backend for NEW uploads. Reads the `appSettings`
 * singleton; falls back to B2 when unset. Shared by the upload mutation so
 * writes honor the admin's choice.
 */
export async function resolveStorageProvider(
  ctx: QueryCtx | MutationCtx,
): Promise<StorageProvider> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
  return normalizeStorageProvider(row?.storageProvider);
}

/** True when `tz` is a valid IANA timezone the runtime recognizes. */
function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    // Throws RangeError for unknown identifiers.
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

export const getTimezone = query({
  args: {},
  returns: v.object({
    timezone: v.string(),
    isDefault: v.boolean(),
    updatedAt: v.optional(v.number()),
  }),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();

    if (!row) {
      return { timezone: DEFAULT_TIMEZONE, isDefault: true, updatedAt: undefined };
    }
    return { timezone: row.timezone, isDefault: false, updatedAt: row.updatedAt };
  },
});

export const setTimezone = mutation({
  args: { timezone: v.string() },
  returns: v.object({ timezone: v.string(), updatedAt: v.number() }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    if (!isValidTimeZone(args.timezone)) {
      throw new Error(
        `"${args.timezone}" is not a valid IANA timezone (e.g. "America/Chicago").`,
      );
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();

    if (existing) {
      if (existing.timezone === args.timezone) {
        return { timezone: existing.timezone, updatedAt: existing.updatedAt };
      }
      await ctx.db.patch(existing._id, {
        timezone: args.timezone,
        updatedBy: admin._id,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        key: "global",
        timezone: args.timezone,
        updatedBy: admin._id,
        updatedAt: now,
      });
    }

    return { timezone: args.timezone, updatedAt: now };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Storage backend (B2 ↔ MinIO)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * UI-ready list of storage backends + which one is active. `isConfigured`
 * reflects whether the backend's env vars are set on the Convex deployment,
 * so the settings card can disable/warn on an unusable option.
 */
export const listStorageProviders = query({
  args: {},
  returns: v.object({
    activeKey: storageProviderValidator,
    providers: v.array(
      v.object({
        key: storageProviderValidator,
        label: v.string(),
        description: v.string(),
        costLabel: v.string(),
        envVar: v.string(),
        isConfigured: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const activeKey = await resolveStorageProvider(ctx);
    const providers = STORAGE_PROVIDERS.map((p) => ({
      key: p.key,
      label: p.label,
      description: p.description,
      costLabel: p.costLabel,
      envVar: p.envVar,
      isConfigured: getConfigForProviderOrNull(p.key) !== null,
    }));
    return { activeKey, providers };
  },
});

/** Active storage backend for new uploads. Absent row/field ⇒ B2 default. */
export const getStorageProvider = query({
  args: {},
  returns: v.object({
    provider: storageProviderValidator,
    isDefault: v.boolean(),
    updatedAt: v.optional(v.number()),
  }),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();

    if (!row || !row.storageProvider) {
      return {
        provider: DEFAULT_STORAGE_PROVIDER,
        isDefault: true,
        updatedAt: row?.updatedAt,
      };
    }
    return {
      provider: row.storageProvider,
      isDefault: false,
      updatedAt: row.updatedAt,
    };
  },
});

/**
 * Switch the active storage backend for NEW uploads. Admin-only.
 *
 * Refuses to select a backend whose env vars aren't configured on the Convex
 * deployment — otherwise every subsequent upload would fail. Existing objects
 * are unaffected: reads always sign each object against its own stored
 * `photos.provider`, so B2 history keeps resolving against B2.
 */
export const setStorageProvider = mutation({
  args: { provider: storageProviderValidator },
  returns: v.object({
    provider: storageProviderValidator,
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    if (getConfigForProviderOrNull(args.provider) === null) {
      throw new Error(
        `Cannot switch storage to "${args.provider}": its env vars are not ` +
          `configured on the Convex deployment. Set them in the Convex ` +
          `dashboard first.`,
      );
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();

    if (existing) {
      if (existing.storageProvider === args.provider) {
        return { provider: args.provider, updatedAt: existing.updatedAt };
      }
      await ctx.db.patch(existing._id, {
        storageProvider: args.provider,
        updatedBy: admin._id,
        updatedAt: now,
      });
    } else {
      // No row yet — seed one. `timezone` is required on the table, so anchor
      // it to the default; an admin can change it from the timezone card.
      await ctx.db.insert("appSettings", {
        key: "global",
        timezone: DEFAULT_TIMEZONE,
        storageProvider: args.provider,
        updatedBy: admin._id,
        updatedAt: now,
      });
    }

    return { provider: args.provider, updatedAt: now };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Rework deadline (org default; per-property override lives on properties)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Org-wide default rework-fix minutes (raw, may be undefined). Used by the
 * reject/reopen mutations to compute `reworkDueAt`. Callers combine it with a
 * per-property override via `resolveReworkDeadlineMinutes`.
 */
export async function readReworkDeadlineMinutes(
  ctx: QueryCtx | MutationCtx,
): Promise<number | undefined> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
  return row?.reworkDeadlineMinutes;
}

export const getReworkDeadlineMinutes = query({
  args: {},
  returns: v.object({
    minutes: v.number(),
    isDefault: v.boolean(),
    updatedAt: v.optional(v.number()),
  }),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();

    if (!row || typeof row.reworkDeadlineMinutes !== "number") {
      return {
        minutes: DEFAULT_REWORK_DEADLINE_MINUTES,
        isDefault: true,
        updatedAt: row?.updatedAt,
      };
    }
    return {
      minutes: row.reworkDeadlineMinutes,
      isDefault: false,
      updatedAt: row.updatedAt,
    };
  },
});

export const setReworkDeadlineMinutes = mutation({
  args: { minutes: v.number() },
  returns: v.object({ minutes: v.number(), updatedAt: v.number() }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    if (
      !Number.isFinite(args.minutes) ||
      !Number.isInteger(args.minutes) ||
      args.minutes < 1 ||
      args.minutes > 24 * 60
    ) {
      throw new Error(
        "Rework deadline must be a whole number of minutes between 1 and 1440.",
      );
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();

    if (existing) {
      if (existing.reworkDeadlineMinutes === args.minutes) {
        return { minutes: args.minutes, updatedAt: existing.updatedAt };
      }
      await ctx.db.patch(existing._id, {
        reworkDeadlineMinutes: args.minutes,
        updatedBy: admin._id,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        key: "global",
        timezone: DEFAULT_TIMEZONE,
        reworkDeadlineMinutes: args.minutes,
        updatedBy: admin._id,
        updatedAt: now,
      });
    }

    return { minutes: args.minutes, updatedAt: now };
  },
});
