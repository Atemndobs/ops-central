import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import type { Doc, Id } from "../_generated/dataModel";

const DEFAULT_LOW_PCT = 40;
const DEFAULT_CRITICAL_PCT = 15;

function isPrivilegedRole(user: Doc<"users">): boolean {
  return (
    user.role === "admin" ||
    user.role === "property_ops" ||
    user.role === "manager"
  );
}

function titleCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeCategory(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return titleCase(trimmed);
}

const ROW = v.object({
  name: v.string(),
  category: v.optional(v.string()),
  room: v.optional(v.string()),
  locationDetail: v.optional(v.string()),
  quantityPurchased: v.number(),
  vendor: v.optional(v.string()),
  url: v.optional(v.string()),
  unitPrice: v.optional(v.number()),
  orderStatus: v.optional(v.string()),
  notes: v.optional(v.string()),
});

export const importItems = mutation({
  args: {
    propertyId: v.id("properties"),
    rows: v.array(ROW),
    mode: v.optional(
      v.union(v.literal("merge"), v.literal("replace"), v.literal("append")),
    ),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!isPrivilegedRole(user)) {
      throw new ConvexError(
        "Only admin, property_ops, or manager can import inventory.",
      );
    }

    const property = await ctx.db.get(args.propertyId);
    if (!property) {
      throw new ConvexError("Property not found.");
    }

    const mode = args.mode ?? "merge";
    const dryRun = args.dryRun ?? false;
    const now = Date.now();

    const existingItems = await ctx.db
      .query("inventoryItems")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();

    const existingByName = new Map<string, Doc<"inventoryItems">>();
    for (const item of existingItems) {
      existingByName.set(item.name.trim().toLowerCase(), item);
    }

    const allCategories = await ctx.db.query("inventoryCategories").collect();
    const categoryByName = new Map<string, Doc<"inventoryCategories">>();
    for (const cat of allCategories) {
      categoryByName.set(cat.name.toLowerCase(), cat);
    }

    type Plan =
      | { kind: "new"; row: (typeof args.rows)[number]; categoryName: string | null }
      | { kind: "update"; row: (typeof args.rows)[number]; categoryName: string | null; existing: Doc<"inventoryItems"> }
      | { kind: "skip"; row: (typeof args.rows)[number]; reason: string }
      | { kind: "error"; row: (typeof args.rows)[number]; reason: string };

    const plan: Plan[] = [];

    for (const row of args.rows) {
      const name = row.name?.trim();
      if (!name) {
        plan.push({ kind: "error", row, reason: "Missing name." });
        continue;
      }
      if (!Number.isFinite(row.quantityPurchased) || row.quantityPurchased < 0) {
        plan.push({ kind: "error", row, reason: "Invalid quantity." });
        continue;
      }

      const categoryName = normalizeCategory(row.category);
      const match = existingByName.get(name.toLowerCase());

      if (match) {
        if (mode === "append") {
          plan.push({ kind: "skip", row, reason: "Duplicate name (append mode)." });
          continue;
        }
        plan.push({ kind: "update", row, categoryName, existing: match });
      } else {
        plan.push({ kind: "new", row, categoryName });
      }
    }

    // Dry-run returns the plan without writing.
    const summary = {
      toInsert: plan.filter((p) => p.kind === "new").length,
      toUpdate: plan.filter((p) => p.kind === "update").length,
      skipped: plan.filter((p) => p.kind === "skip").length,
      errors: plan.filter((p) => p.kind === "error").length,
    };

    if (dryRun) {
      return {
        summary,
        preview: plan.map((p) => {
          if (p.kind === "error" || p.kind === "skip") {
            return { kind: p.kind, name: p.row.name, reason: p.reason };
          }
          return {
            kind: p.kind,
            name: p.row.name,
            category: p.categoryName,
            room: p.row.room ?? null,
            quantityPurchased: p.row.quantityPurchased,
          };
        }),
      };
    }

    // Replace mode: delete all existing items (and dependent queue rows cascade via separate system; for v1 we leave them).
    if (mode === "replace") {
      for (const item of existingItems) {
        await ctx.db.delete(item._id);
      }
      existingByName.clear();
    }

    // Upsert categories first.
    const categoryNamesToEnsure = new Set<string>();
    for (const p of plan) {
      if ((p.kind === "new" || p.kind === "update") && p.categoryName) {
        categoryNamesToEnsure.add(p.categoryName);
      }
    }
    for (const catName of categoryNamesToEnsure) {
      const existingCat = categoryByName.get(catName.toLowerCase());
      if (!existingCat) {
        const id = await ctx.db.insert("inventoryCategories", {
          name: catName,
          sortOrder: categoryByName.size,
          createdAt: now,
        });
        const inserted = await ctx.db.get(id);
        if (inserted) categoryByName.set(catName.toLowerCase(), inserted);
      }
    }

    let displayOrder = 0;
    let inserted = 0;
    let updated = 0;
    const errors: Array<{ name: string; reason: string }> = [];

    for (const step of plan) {
      if (step.kind === "error") {
        errors.push({ name: step.row.name, reason: step.reason });
        continue;
      }
      if (step.kind === "skip") {
        continue;
      }

      const { row, categoryName } = step;
      const categoryDoc = categoryName
        ? categoryByName.get(categoryName.toLowerCase())
        : null;
      const categoryId = categoryDoc?._id as Id<"inventoryCategories"> | undefined;
      const isConsumable = (categoryName ?? "").toLowerCase() === "consumables";

      const metadata: Record<string, unknown> = {};
      if (row.vendor) metadata.vendor = row.vendor.trim();
      if (row.url) metadata.url = row.url.trim();
      if (typeof row.unitPrice === "number") metadata.unitPrice = row.unitPrice;
      if (row.orderStatus) metadata.orderStatus = row.orderStatus.trim();
      if (row.locationDetail) metadata.locationDetail = row.locationDetail.trim();
      if (row.notes) metadata.notes = row.notes.trim();

      if (step.kind === "new") {
        const minQty = Math.max(1, Math.ceil(row.quantityPurchased * 0.2));

        await ctx.db.insert("inventoryItems", {
          propertyId: args.propertyId,
          categoryId,
          name: row.name.trim(),
          room: row.room?.trim() || undefined,
          quantityPurchased: row.quantityPurchased,
          quantityCurrent: row.quantityPurchased,
          minimumQuantity: minQty,
          status: "ok",
          requiresRestock: false,
          isRefillTracked: isConsumable,
          refillLowThresholdPct: isConsumable ? DEFAULT_LOW_PCT : undefined,
          refillCriticalThresholdPct: isConsumable ? DEFAULT_CRITICAL_PCT : undefined,
          refillDisplayOrder: isConsumable ? displayOrder++ : undefined,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          createdAt: now,
        });
        inserted += 1;
      } else {
        const existing = step.existing;
        const mergedMetadata: Record<string, unknown> = {
          ...(existing.metadata && typeof existing.metadata === "object"
            ? (existing.metadata as Record<string, unknown>)
            : {}),
          ...metadata,
        };

        await ctx.db.patch(existing._id, {
          categoryId: categoryId ?? existing.categoryId,
          room: row.room?.trim() || existing.room,
          quantityPurchased: row.quantityPurchased,
          metadata:
            Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
          updatedAt: now,
        });
        updated += 1;
      }
    }

    return {
      summary: { inserted, updated, skipped: summary.skipped, errors: errors.length },
      errors,
    };
  },
});

export const listCategories = query({
  args: {},
  handler: async (ctx) => {
    const cats = await ctx.db
      .query("inventoryCategories")
      .withIndex("by_order")
      .collect();
    return cats.map((c) => ({ _id: c._id, name: c.name }));
  },
});

export const countItemsPerProperty = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!isPrivilegedRole(user)) {
      throw new ConvexError("Not authorized.");
    }

    const items = await ctx.db.query("inventoryItems").collect();
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.propertyId, (counts.get(item.propertyId) ?? 0) + 1);
    }

    const results: Array<{ propertyId: string; name: string; count: number }> = [];
    for (const [propertyId, count] of counts) {
      const prop = await ctx.db.get(propertyId as Id<"properties">);
      results.push({
        propertyId,
        name: prop?.name ?? "(unknown)",
        count,
      });
    }
    return results.sort((a, b) => b.count - a.count);
  },
});

export const _adminClearPropertyInventory = internalMutation({
  args: {
    propertyId: v.id("properties"),
    confirmPropertyName: v.string(),
  },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property) {
      throw new ConvexError("Property not found.");
    }
    if (property.name.trim() !== args.confirmPropertyName.trim()) {
      throw new ConvexError(
        `Safety check failed: expected "${property.name}", got "${args.confirmPropertyName}".`,
      );
    }

    const items = await ctx.db
      .query("inventoryItems")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const itemIds = new Set(items.map((i) => i._id as string));

    const refillQueueRows = await ctx.db.query("refillQueue").collect();
    const toDeleteRefill = refillQueueRows.filter((r) => itemIds.has(r.itemId as string));
    const stockCheckRows = await ctx.db.query("stockChecks").collect();
    const toDeleteStock = stockCheckRows.filter((r) => itemIds.has(r.itemId as string));
    const jobRefillRows = await ctx.db.query("jobRefillChecks").collect();
    const toDeleteJobRefill = jobRefillRows.filter((r) => itemIds.has(r.itemId as string));
    const checkpoints = await ctx.db
      .query("propertyCriticalCheckpoints")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const toUnlinkCheckpoints = checkpoints.filter(
      (c) => c.linkedInventoryItemId && itemIds.has(c.linkedInventoryItemId as string),
    );

    for (const row of toDeleteRefill) await ctx.db.delete(row._id);
    for (const row of toDeleteStock) await ctx.db.delete(row._id);
    for (const row of toDeleteJobRefill) await ctx.db.delete(row._id);
    for (const cp of toUnlinkCheckpoints) {
      await ctx.db.patch(cp._id, { linkedInventoryItemId: undefined, updatedAt: Date.now() });
    }
    for (const item of items) await ctx.db.delete(item._id);

    return {
      property: property.name,
      deletedItems: items.length,
      deletedRefillQueue: toDeleteRefill.length,
      deletedStockChecks: toDeleteStock.length,
      deletedJobRefillChecks: toDeleteJobRefill.length,
      unlinkedCheckpoints: toUnlinkCheckpoints.length,
    };
  },
});

export const clearPropertyInventory = mutation({
  args: {
    propertyId: v.id("properties"),
    confirmPropertyName: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!isPrivilegedRole(user)) {
      throw new ConvexError("Not authorized.");
    }

    const property = await ctx.db.get(args.propertyId);
    if (!property) {
      throw new ConvexError("Property not found.");
    }
    if (property.name.trim() !== args.confirmPropertyName.trim()) {
      throw new ConvexError(
        `Safety check failed: expected "${property.name}", got "${args.confirmPropertyName}".`,
      );
    }

    const items = await ctx.db
      .query("inventoryItems")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();

    const itemIds = new Set(items.map((i) => i._id as string));

    // Also wipe dependent rows so we don't orphan them.
    const refillQueueRows = await ctx.db.query("refillQueue").collect();
    const toDeleteRefill = refillQueueRows.filter((r) => itemIds.has(r.itemId as string));

    const stockCheckRows = await ctx.db.query("stockChecks").collect();
    const toDeleteStock = stockCheckRows.filter((r) => itemIds.has(r.itemId as string));

    const jobRefillRows = await ctx.db.query("jobRefillChecks").collect();
    const toDeleteJobRefill = jobRefillRows.filter((r) => itemIds.has(r.itemId as string));

    // Unlink any critical checkpoints referencing these items (keep the checkpoint, drop the link).
    const checkpoints = await ctx.db
      .query("propertyCriticalCheckpoints")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const toUnlinkCheckpoints = checkpoints.filter(
      (c) => c.linkedInventoryItemId && itemIds.has(c.linkedInventoryItemId as string),
    );

    for (const row of toDeleteRefill) await ctx.db.delete(row._id);
    for (const row of toDeleteStock) await ctx.db.delete(row._id);
    for (const row of toDeleteJobRefill) await ctx.db.delete(row._id);
    for (const cp of toUnlinkCheckpoints) {
      await ctx.db.patch(cp._id, { linkedInventoryItemId: undefined, updatedAt: Date.now() });
    }
    for (const item of items) await ctx.db.delete(item._id);

    return {
      deletedItems: items.length,
      deletedRefillQueue: toDeleteRefill.length,
      deletedStockChecks: toDeleteStock.length,
      deletedJobRefillChecks: toDeleteJobRefill.length,
      unlinkedCheckpoints: toUnlinkCheckpoints.length,
    };
  },
});
