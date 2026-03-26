import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { type Doc, type Id } from "../_generated/dataModel";
import { requireRole } from "../lib/auth";

const appRoleValidator = v.union(
  v.literal("cleaner"),
  v.literal("manager"),
  v.literal("property_ops"),
  v.literal("admin"),
);

const companyMemberRoleValidator = v.union(
  v.literal("cleaner"),
  v.literal("manager"),
  v.literal("owner"),
);

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function latestMembership(
  rows: Doc<"companyMembers">[],
): Doc<"companyMembers"> | null {
  if (rows.length === 0) {
    return null;
  }
  return rows.reduce((latest, row) =>
    row.joinedAt > latest.joinedAt ? row : latest,
  );
}

export const createUser = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    role: appRoleValidator,
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);

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
      role: args.role,
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
    role: v.optional(appRoleValidator),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);

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
      updates.role = fields.role;
    }

    await ctx.db.patch(id, updates);

    return { success: true };
  },
});

export const assignUserCompanyMembership = mutation({
  args: {
    userId: v.id("users"),
    companyId: v.union(v.id("cleaningCompanies"), v.null()),
    memberRole: v.optional(companyMemberRoleValidator),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError("User not found.");
    }

    const now = Date.now();
    const memberships = await ctx.db
      .query("companyMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Deactivate all active memberships when company is cleared.
    if (args.companyId === null) {
      for (const membership of memberships) {
        if (membership.isActive) {
          await ctx.db.patch(membership._id, {
            isActive: false,
            leftAt: now,
          });
        }
      }

      return {
        success: true,
        userId: args.userId,
        companyId: null,
      };
    }

    const company = await ctx.db.get(args.companyId);
    if (!company) {
      throw new ConvexError("Company not found.");
    }

    const desiredRole =
      args.memberRole ?? (user.role === "manager" ? "manager" : "cleaner");

    for (const membership of memberships) {
      if (membership.isActive && membership.companyId !== args.companyId) {
        await ctx.db.patch(membership._id, {
          isActive: false,
          leftAt: now,
        });
      }
    }

    const sameCompanyMemberships = memberships.filter(
      (membership) => membership.companyId === args.companyId,
    );
    const existingMembership = latestMembership(sameCompanyMemberships);

    if (existingMembership) {
      await ctx.db.patch(existingMembership._id, {
        isActive: true,
        leftAt: undefined,
        role: desiredRole,
      });
    } else {
      await ctx.db.insert("companyMembers", {
        companyId: args.companyId,
        userId: args.userId,
        role: desiredRole,
        isActive: true,
        joinedAt: now,
      });
    }

    return {
      success: true,
      userId: args.userId,
      companyId: args.companyId as Id<"cleaningCompanies">,
      companyName: company.name,
      memberRole: desiredRole,
    };
  },
});

export const upsertUserFromClerkWebhook = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    role: v.optional(appRoleValidator),
    webhookToken: v.string(),
  },
  handler: async (ctx, args) => {
    const expectedWebhookToken = process.env.CLERK_WEBHOOK_SYNC_TOKEN;
    if (!expectedWebhookToken) {
      throw new ConvexError(
        "CLERK_WEBHOOK_SYNC_TOKEN is not configured in Convex.",
      );
    }
    if (args.webhookToken !== expectedWebhookToken) {
      throw new ConvexError("Invalid webhook token.");
    }

    const now = Date.now();
    const normalizedEmail = normalizeEmail(args.email);
    const normalizedName = hasValue(args.name) ? args.name.trim() : undefined;
    const normalizedAvatarUrl = hasValue(args.avatarUrl)
      ? args.avatarUrl.trim()
      : undefined;

    let existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .first();

    if (!existingUser) {
      existingUser = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
        .first();
    }

    if (!existingUser) {
      const users = await ctx.db.query("users").collect();
      existingUser =
        users.find((user) => normalizeEmail(user.email) === normalizedEmail) ??
        null;
    }

    if (existingUser) {
      const updates: Partial<Doc<"users">> = {
        clerkId: args.clerkId,
        email: normalizedEmail,
        updatedAt: now,
      };

      if (normalizedName !== undefined) {
        updates.name = normalizedName;
      }
      if (normalizedAvatarUrl !== undefined) {
        updates.avatarUrl = normalizedAvatarUrl;
      }
      if (args.role !== undefined) {
        updates.role = args.role;
      }

      await ctx.db.patch(existingUser._id, updates);
      return {
        userId: existingUser._id,
        created: false,
      };
    }

    const userId = await ctx.db.insert("users", {
      clerkId: args.clerkId,
      email: normalizedEmail,
      name: normalizedName,
      avatarUrl: normalizedAvatarUrl,
      role: args.role ?? "cleaner",
      createdAt: now,
      updatedAt: now,
    });

    return {
      userId,
      created: true,
    };
  },
});
