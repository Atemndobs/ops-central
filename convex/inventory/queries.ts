import { v } from "convex/values";
import { query } from "../_generated/server";

export const getAll = query({
  args: {
    propertyId: v.optional(v.id("properties")),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let items;

    if (args.propertyId) {
      items = await ctx.db
        .query("inventoryItems")
        .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId!))
        .collect();
    } else {
      items = await ctx.db.query("inventoryItems").collect();
    }

    if (args.status) {
      items = items.filter((item) => item.status === args.status);
    }

    // Enrich with category name
    const categoryIds = [...new Set(items.map((item) => item.categoryId).filter(Boolean))];
    const categories = await Promise.all(categoryIds.map((id) => ctx.db.get(id!)));
    const categoryById = new Map(
      categories
        .filter(Boolean)
        .map((cat) => [cat!._id as string, cat!.name as string]),
    );

    return items.map((item) => ({
      ...item,
      categoryName: item.categoryId ? (categoryById.get(item.categoryId as string) ?? null) : null,
    }));
  },
});

export const getLowStock = query({
  args: {},
  handler: async (ctx) => {
    const lowStock = await ctx.db
      .query("inventoryItems")
      .withIndex("by_status", (q) => q.eq("status", "low_stock"))
      .collect();

    const outOfStock = await ctx.db
      .query("inventoryItems")
      .withIndex("by_status", (q) => q.eq("status", "out_of_stock"))
      .collect();

    const items = [...lowStock, ...outOfStock];

    // Collect unique category and property IDs
    const categoryIds = [...new Set(items.map((item) => item.categoryId).filter(Boolean))];
    const propertyIds = [...new Set(items.map((item) => item.propertyId))];

    const [categories, properties] = await Promise.all([
      Promise.all(categoryIds.map((id) => ctx.db.get(id!))),
      Promise.all(propertyIds.map((id) => ctx.db.get(id))),
    ]);

    const categoryById = new Map(
      categories
        .filter(Boolean)
        .map((cat) => [cat!._id as string, cat!.name as string]),
    );

    const propertyById = new Map(
      properties
        .filter(Boolean)
        .map((prop) => [prop!._id as string, prop!.name as string]),
    );

    return items.map((item) => ({
      ...item,
      categoryName: item.categoryId ? (categoryById.get(item.categoryId as string) ?? null) : null,
      propertyName: propertyById.get(item.propertyId as string) ?? null,
    }));
  },
});

export const getGlobalStats = query({
  args: {},
  handler: async (ctx) => {
    const allItems = await ctx.db.query("inventoryItems").collect();

    const totalItems = allItems.length;
    const lowStockCount = allItems.filter((item) => item.status === "low_stock").length;
    const outOfStockCount = allItems.filter((item) => item.status === "out_of_stock").length;

    const allCategories = await ctx.db.query("inventoryCategories").collect();
    const categoriesCount = allCategories.length;

    return {
      totalItems,
      lowStockCount,
      outOfStockCount,
      categoriesCount,
    };
  },
});
