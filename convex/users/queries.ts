import { v } from "convex/values";
import { query } from "../_generated/server";

export const getByRole = query({
  args: {
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", args.role as "cleaner" | "manager" | "property_ops" | "admin"))
      .collect();

    return users.sort((a, b) => {
      const nameA = a.name ?? a.email ?? "";
      const nameB = b.name ?? b.email ?? "";
      return nameA.localeCompare(nameB);
    });
  },
});

export const getByClerkId = query({
  args: {
    clerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .first();

    return user ?? null;
  },
});
