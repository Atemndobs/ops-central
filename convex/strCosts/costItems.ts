import { query, mutation } from "../_generated/server";
import { v } from "convex/values";

// ─────────────────────────────────────────────────────────────────────────────
// Per-property cost-line CRUD for the Monthly Close "Property Costs" editor.
//
// Ported/adapted from jna-bs-admin convex/strCosts/{queries,mutations}.ts. These
// are the recurring `propertyCostItems` rows the deterministic engine consumes
// (lease, cleaning, utilities, subscriptions, …). Categories come from the
// existing owner-portal `costCategories` table (13-bucket vocab); the engine
// maps those to its 7 buckets via strCosts/buckets.ts.
// ─────────────────────────────────────────────────────────────────────────────

const FREQUENCY = v.union(
  v.literal("one_time"),
  v.literal("monthly"),
  v.literal("quarterly"),
  v.literal("annual"),
  v.literal("yearly"),
  v.literal("per_booking"),
  v.literal("revenue_percentage"),
);

/** All cost categories (for the category picker), sorted by sortOrder. */
export const listCostCategories = query({
  args: {},
  handler: async (ctx) => {
    const categories = await ctx.db.query("costCategories").collect();
    return categories
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((c) => ({ _id: c._id, name: c.name, bucket: c.bucket, isFixed: c.isFixed }));
  },
});

/** Cost lines for one property, enriched with their category {name, bucket}. */
export const listPropertyCostItems = query({
  args: {
    propertyId: v.id("properties"),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let items = await ctx.db
      .query("propertyCostItems")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();

    if (!args.includeInactive) items = items.filter((i) => i.isActive);

    const categories = await ctx.db.query("costCategories").collect();
    const catMap = new Map(categories.map((c) => [c._id as string, c]));

    return items
      .map((item) => {
        const cat = catMap.get(item.categoryId as string) ?? null;
        return {
          _id: item._id,
          propertyId: item.propertyId,
          categoryId: item.categoryId,
          name: item.name,
          amount: item.amount,
          frequency: item.frequency,
          percentageRate: item.percentageRate ?? null,
          isActive: item.isActive,
          category: cat ? { _id: cat._id, name: cat.name, bucket: cat.bucket } : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createPropertyCostItem = mutation({
  args: {
    propertyId: v.id("properties"),
    categoryId: v.id("costCategories"),
    name: v.string(),
    amount: v.number(),
    frequency: FREQUENCY,
    percentageRate: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("propertyCostItems", {
      propertyId: args.propertyId,
      categoryId: args.categoryId,
      name: args.name.trim(),
      amount: args.amount,
      frequency: args.frequency,
      percentageRate: args.percentageRate,
      isActive: args.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updatePropertyCostItem = mutation({
  args: {
    id: v.id("propertyCostItems"),
    name: v.optional(v.string()),
    amount: v.optional(v.number()),
    frequency: v.optional(FREQUENCY),
    percentageRate: v.optional(v.number()),
    categoryId: v.optional(v.id("costCategories")),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Cost item not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (updates.name !== undefined) patch.name = updates.name.trim();
    if (updates.amount !== undefined) patch.amount = updates.amount;
    if (updates.frequency !== undefined) patch.frequency = updates.frequency;
    if (updates.percentageRate !== undefined) patch.percentageRate = updates.percentageRate;
    if (updates.categoryId !== undefined) patch.categoryId = updates.categoryId;
    if (updates.isActive !== undefined) patch.isActive = updates.isActive;

    await ctx.db.patch(id, patch);
    return await ctx.db.get(id);
  },
});

export const deletePropertyCostItem = mutation({
  args: { id: v.id("propertyCostItems") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Cost item not found");
    await ctx.db.delete(args.id);
    return { success: true };
  },
});
