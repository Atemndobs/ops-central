import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { type Doc, type Id } from "../_generated/dataModel";
import { requireRole } from "../lib/auth";
import {
  readProfileOverrides,
  setProfileOverride,
} from "../lib/profileMetadata";

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

function normalizeCompanyName(value: string): string {
  return value.trim().toLowerCase();
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

function isActiveCompanyPropertyAssignment(
  row: Doc<"companyProperties">,
): boolean {
  return row.isActive !== false && row.unassignedAt === undefined;
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

export const upsertUserFromDirectory = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    phone: v.optional(v.string()),
    role: v.optional(appRoleValidator),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);

    const now = Date.now();
    const normalizedEmail = normalizeEmail(args.email);
    const normalizedName = hasValue(args.name) ? args.name.trim() : undefined;
    const normalizedAvatarUrl = hasValue(args.avatarUrl)
      ? args.avatarUrl.trim()
      : undefined;
    const normalizedPhone = hasValue(args.phone) ? args.phone.trim() : undefined;

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
      if (normalizedPhone !== undefined) {
        updates.phone = normalizedPhone;
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
      phone: normalizedPhone,
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

export const updateUser = mutation({
  args: {
    id: v.id("users"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
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
    let nextMetadata = user.metadata;

    if (fields.name !== undefined) {
      const normalizedName = fields.name.trim();
      if (normalizedName.length === 0) {
        throw new ConvexError("Name cannot be empty.");
      }
      updates.name = normalizedName;
      nextMetadata = setProfileOverride(nextMetadata, "name", true);
    }
    if (fields.email !== undefined) updates.email = fields.email;
    if (fields.phone !== undefined) {
      const normalizedPhone = fields.phone.trim();
      updates.phone = normalizedPhone.length > 0 ? normalizedPhone : undefined;
    }
    if (fields.avatarUrl !== undefined) {
      const normalizedAvatarUrl = fields.avatarUrl.trim();
      if (normalizedAvatarUrl.length === 0) {
        throw new ConvexError("Avatar URL cannot be empty.");
      }
      updates.avatarUrl = normalizedAvatarUrl;
      nextMetadata = setProfileOverride(nextMetadata, "avatarUrl", true);
    }
    if (fields.role !== undefined) {
      updates.role = fields.role;
    }

    if (nextMetadata !== user.metadata) {
      updates.metadata = nextMetadata;
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

export const createCleaningCompany = mutation({
  args: {
    name: v.string(),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    city: v.optional(v.string()),
    ownerUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["admin"]);
    const now = Date.now();
    const name = args.name.trim();
    if (!name) {
      throw new ConvexError("Company name is required.");
    }

    const normalizedName = normalizeCompanyName(name);
    const existingCompanies = await ctx.db.query("cleaningCompanies").collect();
    const duplicate = existingCompanies.find(
      (company) => normalizeCompanyName(company.name) === normalizedName,
    );
    if (duplicate) {
      throw new ConvexError(
        `A company named "${duplicate.name}" already exists.`,
      );
    }

    if (args.ownerUserId) {
      const owner = await ctx.db.get(args.ownerUserId);
      if (!owner) {
        throw new ConvexError("Owner user not found.");
      }
    }

    const companyId = await ctx.db.insert("cleaningCompanies", {
      name,
      ownerId: args.ownerUserId,
      contactEmail: args.contactEmail?.trim(),
      contactPhone: args.contactPhone?.trim(),
      city: args.city?.trim() || undefined,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    if (args.ownerUserId) {
      await ctx.db.insert("companyMembers", {
        companyId,
        userId: args.ownerUserId,
        role: "owner",
        isActive: true,
        joinedAt: now,
      });
    }

    return {
      success: true,
      companyId,
      createdBy: actor._id,
    };
  },
});

export const updateCleaningCompany = mutation({
  args: {
    companyId: v.id("cleaningCompanies"),
    name: v.string(),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    city: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const now = Date.now();

    const company = await ctx.db.get(args.companyId);
    if (!company) {
      throw new ConvexError("Company not found.");
    }
    if (!company.isActive) {
      throw new ConvexError("Cannot edit an archived company.");
    }

    const name = args.name.trim();
    if (!name) {
      throw new ConvexError("Company name is required.");
    }

    const normalizedName = normalizeCompanyName(name);
    const existingCompanies = await ctx.db.query("cleaningCompanies").collect();
    const duplicate = existingCompanies.find(
      (candidate) =>
        candidate._id !== args.companyId &&
        candidate.isActive &&
        normalizeCompanyName(candidate.name) === normalizedName,
    );
    if (duplicate) {
      throw new ConvexError(`A company named "${duplicate.name}" already exists.`);
    }

    await ctx.db.patch(args.companyId, {
      name,
      contactEmail: hasValue(args.contactEmail) ? args.contactEmail.trim() : undefined,
      contactPhone: hasValue(args.contactPhone) ? args.contactPhone.trim() : undefined,
      logoUrl: hasValue(args.logoUrl) ? args.logoUrl.trim() : undefined,
      city: hasValue(args.city) ? args.city.trim() : undefined,
      updatedAt: now,
    });

    return {
      success: true,
      companyId: args.companyId,
    };
  },
});

export const archiveCleaningCompany = mutation({
  args: {
    companyId: v.id("cleaningCompanies"),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const now = Date.now();

    const company = await ctx.db.get(args.companyId);
    if (!company) {
      throw new ConvexError("Company not found.");
    }
    if (!company.isActive) {
      return {
        success: true,
        companyId: args.companyId,
        archived: false,
        alreadyArchived: true,
      };
    }

    const propertyAssignments = await ctx.db
      .query("companyProperties")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .collect();
    const activeAssignments = propertyAssignments.filter(isActiveCompanyPropertyAssignment);
    if (activeAssignments.length > 0) {
      throw new ConvexError(
        "Unassign all active properties from this company before archiving it.",
      );
    }

    const memberships = await ctx.db
      .query("companyMembers")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .collect();
    for (const membership of memberships) {
      if (membership.isActive) {
        await ctx.db.patch(membership._id, {
          isActive: false,
          leftAt: now,
        });
      }
    }

    await ctx.db.patch(args.companyId, {
      isActive: false,
      updatedAt: now,
    });

    return {
      success: true,
      companyId: args.companyId,
      archived: true,
      deactivatedMemberships: memberships.filter((membership) => membership.isActive).length,
    };
  },
});

export const assignPropertyToCompany = mutation({
  args: {
    propertyId: v.id("properties"),
    companyId: v.id("cleaningCompanies"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["admin", "property_ops"]);
    const now = Date.now();

    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.isActive) {
      throw new ConvexError("Property not found.");
    }

    const company = await ctx.db.get(args.companyId);
    if (!company || !company.isActive) {
      throw new ConvexError("Cleaning company not found or inactive.");
    }

    const assignments = await ctx.db
      .query("companyProperties")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();

    const activeAssignments = assignments
      .filter(isActiveCompanyPropertyAssignment)
      .sort((a, b) => b.assignedAt - a.assignedAt);

    let existingTargetAssignmentId: Id<"companyProperties"> | null = null;
    for (const assignment of activeAssignments) {
      if (
        assignment.companyId === args.companyId &&
        existingTargetAssignmentId === null
      ) {
        existingTargetAssignmentId = assignment._id;
        continue;
      }

      await ctx.db.patch(assignment._id, {
        isActive: false,
        unassignedAt: now,
        unassignedBy: actor._id,
        unassignedReason: args.reason?.trim() || "reassigned",
      });
    }

    if (existingTargetAssignmentId) {
      return {
        success: true,
        propertyId: args.propertyId,
        companyId: args.companyId,
        assignmentId: existingTargetAssignmentId,
        changed: false,
      };
    }

    const assignmentId = await ctx.db.insert("companyProperties", {
      propertyId: args.propertyId,
      companyId: args.companyId,
      assignedAt: now,
      assignedBy: actor._id,
      isActive: true,
    });

    return {
      success: true,
      propertyId: args.propertyId,
      companyId: args.companyId,
      assignmentId,
      changed: true,
    };
  },
});

export const removePropertyCompanyAssignment = mutation({
  args: {
    propertyId: v.id("properties"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["admin", "property_ops"]);
    const now = Date.now();

    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.isActive) {
      throw new ConvexError("Property not found.");
    }

    const assignments = await ctx.db
      .query("companyProperties")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();

    const activeAssignments = assignments.filter(isActiveCompanyPropertyAssignment);
    for (const assignment of activeAssignments) {
      await ctx.db.patch(assignment._id, {
        isActive: false,
        unassignedAt: now,
        unassignedBy: actor._id,
        unassignedReason: args.reason?.trim() || "manual_unassign",
      });
    }

    return {
      success: true,
      propertyId: args.propertyId,
      removedCount: activeAssignments.length,
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
      const profileOverrides = readProfileOverrides(existingUser.metadata);
      const updates: Partial<Doc<"users">> = {
        clerkId: args.clerkId,
        email: normalizedEmail,
        updatedAt: now,
      };

      if (!profileOverrides.name && normalizedName !== undefined) {
        updates.name = normalizedName;
      }
      if (!profileOverrides.avatarUrl && normalizedAvatarUrl !== undefined) {
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
