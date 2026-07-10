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
import { requireAdmin } from "./lib/auth";

// "App operated in Dallas" — Central Time is the default display zone.
export const DEFAULT_TIMEZONE = "America/Chicago";

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
