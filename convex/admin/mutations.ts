import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";

export const createUser = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .first();

    if (existing) {
      throw new ConvexError("A user with this Clerk ID already exists.");
    }

    const userId = await ctx.db.insert("users", {
      clerkId: args.clerkId,
      email: args.email,
      name: args.name,
      phone: args.phone,
      role: args.role as "cleaner" | "manager" | "property_ops" | "admin",
      createdAt: Date.now(),
    });

    return { success: true, userId };
  },
});

export const updateUser = mutation({
  args: {
    id: v.id("users"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    role: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.id);

    if (!user) {
      throw new ConvexError("User not found.");
    }

    const { id, ...fields } = args;

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (fields.name !== undefined) updates.name = fields.name;
    if (fields.email !== undefined) updates.email = fields.email;
    if (fields.phone !== undefined) updates.phone = fields.phone;
    if (fields.role !== undefined) {
      updates.role = fields.role as "cleaner" | "manager" | "property_ops" | "admin";
    }

    await ctx.db.patch(id, updates);

    return { success: true };
  },
});
