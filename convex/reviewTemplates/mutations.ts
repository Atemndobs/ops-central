import { v } from "convex/values";
import { mutation, internalMutation } from "../_generated/server";
import { requireRole } from "../lib/auth";
import { TEMPLATES } from "./seed";

// Upsert a single template block (used by seed + future admin UI edits)
export const upsert = mutation({
  args: {
    reviewCategory: v.union(
      v.literal("glowing_5star"),
      v.literal("positive_4star"),
      v.literal("mixed_3star"),
      v.literal("critical_2star"),
    ),
    incentive: v.union(
      v.literal("none"),
      v.literal("return_discount"),
      v.literal("google_review"),
      v.literal("early_late_checkin"),
    ),
    label: v.string(),
    opener: v.string(),
    acknowledgment: v.string(),
    addressIssue: v.optional(v.string()),
    inviteBack: v.string(),
    incentiveText: v.string(),
    closer: v.string(),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const existing = await ctx.db
      .query("reviewResponseTemplates")
      .collect()
      .then((rows) =>
        rows.find(
          (r) =>
            r.reviewCategory === args.reviewCategory &&
            r.incentive === args.incentive,
        ),
      );
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return ctx.db.insert("reviewResponseTemplates", args);
  },
});

// Seeds all 16 pre-built template combinations. Safe to re-run; upserts by key.
export const seedAll = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const existing = await ctx.db.query("reviewResponseTemplates").collect();
    const byKey = new Map(
      existing.map((r) => [`${r.reviewCategory}:${r.incentive}`, r]),
    );
    let created = 0;
    let updated = 0;
    for (const t of TEMPLATES) {
      const key = `${t.reviewCategory}:${t.incentive}`;
      const row = byKey.get(key);
      if (row) {
        await ctx.db.patch(row._id, t);
        updated++;
      } else {
        await ctx.db.insert("reviewResponseTemplates", t);
        created++;
      }
    }
    return { created, updated, total: TEMPLATES.length };
  },
});

// Internal twin of seedAll, runnable from the Convex CLI (no user identity).
// Used to push template copy edits to prod: `npx convex run
// reviewTemplates/mutations:seedAllInternal`.
export const seedAllInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("reviewResponseTemplates").collect();
    const byKey = new Map(
      existing.map((r) => [`${r.reviewCategory}:${r.incentive}`, r]),
    );
    let created = 0;
    let updated = 0;
    for (const t of TEMPLATES) {
      const key = `${t.reviewCategory}:${t.incentive}`;
      const row = byKey.get(key);
      if (row) {
        await ctx.db.patch(row._id, t);
        updated++;
      } else {
        await ctx.db.insert("reviewResponseTemplates", t);
        created++;
      }
    }
    return { created, updated, total: TEMPLATES.length };
  },
});

export const deleteAll = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const all = await ctx.db.query("reviewResponseTemplates").collect();
    await Promise.all(all.map((r) => ctx.db.delete(r._id)));
  },
});
