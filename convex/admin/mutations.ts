import { ConvexError, v } from "convex/values";
import { mutation, internalMutation, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
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
  v.literal("owner"),
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
    // Owner's company for the Chez Soi Stays statement (empty string clears it).
    company: v.optional(v.string()),
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
    if (fields.company !== undefined) {
      const normalizedCompany = fields.company.trim();
      updates.company = normalizedCompany.length > 0 ? normalizedCompany : undefined;
    }

    if (nextMetadata !== user.metadata) {
      updates.metadata = nextMetadata;
    }

    await ctx.db.patch(id, updates);

    // If role changed, sync to Clerk publicMetadata + revoke active sessions
    // so the new role takes effect on next request. Fire-and-forget — the
    // mutation succeeds even if Clerk is down (eventual consistency).
    // Without this, middleware reads stale role from JWT (cf. Randalls hot-fix).
    if (fields.role !== undefined && fields.role !== user.role) {
      await ctx.scheduler.runAfter(0, internal.clerk.actions.syncUserRoleToClerk, {
        clerkId: user.clerkId,
        role: fields.role,
      });
    }

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

/**
 * Ops one-off: set (or clear) an owner's statement company by email. Internal —
 * not client-callable; run via `npx convex run admin/mutations:setOwnerCompanyByEmail`.
 * Used to backfill owner companies (e.g. Randalls → "J&A Business Solutions LLC").
 */
export const setOwnerCompanyByEmail = internalMutation({
  args: { email: v.string(), company: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    if (!user) throw new ConvexError(`No user with email ${args.email}`);
    const company = args.company.trim();
    await ctx.db.patch(user._id, {
      company: company.length > 0 ? company : undefined,
      updatedAt: Date.now(),
    });
    return { userId: user._id, name: user.name ?? null, company: company || null };
  },
});

type RemoveUserResult =
  | {
      deleted: true;
      clerkId: string;
      name: string | null;
      email: string | null;
      cascaded: {
        userRoles: number;
        companyMemberships: number;
        notifications: number;
        propertyOpsAssignments: number;
      };
    }
  | { deleted: false; blockers: string[] };

/**
 * Reference-safe removal of a user document, shared by the admin delete
 * mutation and the Clerk `user.deleted` webhook.
 *
 * Refuses to delete a user who still carries operational HISTORY (cleaning
 * jobs, incidents, uploaded photos, stock/inventory checks, an owned
 * cleaning company, a property-ownership stake, or actions taken ON other
 * users such as granting roles / assigning properties) — deleting those
 * would orphan records that point at the user. When there is no such
 * history, the user's own trivia rows (personal role rows, company
 * memberships, notifications, property-ops assignments where they are the
 * subject) are cascaded away and the user document is deleted.
 *
 * Returns `{ deleted: false, blockers }` instead of throwing so each caller
 * can decide how to surface the refusal (the mutation throws; the webhook
 * no-ops). Never touches Clerk — external calls aren't allowed in a
 * mutation, so Clerk deletion is orchestrated by the API route.
 */
async function removeUserRecord(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<RemoveUserResult> {
  const target = await ctx.db.get(userId);
  if (!target) {
    return { deleted: false, blockers: ["user no longer exists"] };
  }

  const blockers: string[] = [];

  // --- Blocking references: real operational history ---
  const ownedCompanies = await ctx.db
    .query("cleaningCompanies")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  if (ownedCompanies.length > 0) {
    blockers.push(`${ownedCompanies.length} owned company(ies)`);
  }

  const allJobs = await ctx.db.query("cleaningJobs").collect();
  const jobRefs = allJobs.filter(
    (job) =>
      job.assignedCleanerIds.includes(userId) ||
      job.assignedManagerId === userId ||
      job.approvedBy === userId ||
      job.rejectedBy === userId,
  ).length;
  if (jobRefs > 0) {
    blockers.push(`${jobRefs} cleaning job link(s)`);
  }

  const allIncidents = await ctx.db.query("incidents").collect();
  const incidentRefs = allIncidents.filter(
    (row) => row.reportedBy === userId || row.resolvedBy === userId,
  ).length;
  if (incidentRefs > 0) {
    blockers.push(`${incidentRefs} incident link(s)`);
  }

  const allPhotos = await ctx.db.query("photos").collect();
  const photoRefs = allPhotos.filter((row) => row.uploadedBy === userId).length;
  if (photoRefs > 0) {
    blockers.push(`${photoRefs} uploaded photo(s)`);
  }

  const allStockChecks = await ctx.db.query("stockChecks").collect();
  const stockRefs = allStockChecks.filter(
    (row) => row.checkedBy === userId,
  ).length;
  if (stockRefs > 0) {
    blockers.push(`${stockRefs} stock check(s)`);
  }

  const allInventoryItems = await ctx.db.query("inventoryItems").collect();
  const inventoryRefs = allInventoryItems.filter(
    (row) => row.lastCheckedBy === userId,
  ).length;
  if (inventoryRefs > 0) {
    blockers.push(`${inventoryRefs} inventory check(s)`);
  }

  const propertyOwnerRows = await ctx.db
    .query("propertyOwners")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  if (propertyOwnerRows.length > 0) {
    blockers.push(`${propertyOwnerRows.length} property-ownership stake(s)`);
  }

  // Actions taken ON other users (would orphan someone else's record).
  const allUserRoles = await ctx.db.query("userRoles").collect();
  const grantedByRefs = allUserRoles.filter(
    (row) => row.grantedBy === userId,
  ).length;
  if (grantedByRefs > 0) {
    blockers.push(`${grantedByRefs} role(s) they granted to others`);
  }

  const allCompanyProperties = await ctx.db
    .query("companyProperties")
    .collect();
  const companyPropAssignedBy = allCompanyProperties.filter(
    (row) => row.assignedBy === userId,
  ).length;
  if (companyPropAssignedBy > 0) {
    blockers.push(`${companyPropAssignedBy} property-to-company assignment(s)`);
  }

  const allPropertyOps = await ctx.db
    .query("propertyOpsAssignments")
    .collect();
  const opsAssignedBy = allPropertyOps.filter(
    (row) => row.assignedBy === userId,
  ).length;
  if (opsAssignedBy > 0) {
    blockers.push(`${opsAssignedBy} property-ops assignment(s) they made`);
  }

  if (blockers.length > 0) {
    return { deleted: false, blockers };
  }

  // --- Safe cascade: the user's own trivia rows ---
  const ownRoleRows = allUserRoles.filter((row) => row.userId === userId);
  for (const row of ownRoleRows) {
    await ctx.db.delete(row._id);
  }

  const ownMemberships = await ctx.db
    .query("companyMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const row of ownMemberships) {
    await ctx.db.delete(row._id);
  }

  const ownNotifications = await ctx.db
    .query("notifications")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const row of ownNotifications) {
    await ctx.db.delete(row._id);
  }

  const ownOpsAssignments = allPropertyOps.filter(
    (row) => row.userId === userId,
  );
  for (const row of ownOpsAssignments) {
    await ctx.db.delete(row._id);
  }

  const clerkId = target.clerkId;
  await ctx.db.delete(userId);

  return {
    deleted: true,
    clerkId,
    name: target.name ?? null,
    email: target.email ?? null,
    cascaded: {
      userRoles: ownRoleRows.length,
      companyMemberships: ownMemberships.length,
      notifications: ownNotifications.length,
      propertyOpsAssignments: ownOpsAssignments.length,
    },
  };
}

/**
 * Permanently delete a team member from Convex. Admin-only.
 *
 * Throws a ConvexError (surfaced to the admin) when the user still has
 * operational history. Returns the Clerk ID on success so the calling API
 * route can also delete the identity from Clerk
 * (see src/app/api/team-members/route.ts DELETE).
 */
export const deleteUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["admin"]);

    const target = await ctx.db.get(args.userId);
    if (!target) {
      throw new ConvexError("User not found.");
    }
    if (target._id === actor._id) {
      throw new ConvexError(
        "You cannot delete your own account from the admin UI.",
      );
    }

    const displayName = target.name ?? target.email ?? "this user";
    const result = await removeUserRecord(ctx, args.userId);

    if (!result.deleted) {
      throw new ConvexError(
        `Can't delete ${displayName} — they still have ${result.blockers.join(", ")}. ` +
          `Deleting would orphan that history. Deactivate the account or change ` +
          `their role instead, or reassign the work first.`,
      );
    }

    return {
      success: true,
      clerkId: result.clerkId,
      name: result.name,
      email: result.email,
      cascaded: result.cascaded,
    };
  },
});

/**
 * Convex-side handler for Clerk's `user.deleted` webhook. Authenticated by
 * the shared webhook token (the browser client is never involved). Finds
 * the Convex user by Clerk ID and removes it if reference-safe; if the user
 * still has operational history the row is KEPT (returned as `ignored`) so
 * nothing is orphaned — an admin can reconcile it manually.
 */
export const deleteUserFromClerkWebhook = mutation({
  args: { clerkId: v.string(), webhookToken: v.string() },
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

    const target = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .first();
    if (!target) {
      return { deleted: false, reason: "not_found" as const };
    }

    const result = await removeUserRecord(ctx, target._id);
    if (!result.deleted) {
      return {
        deleted: false,
        reason: "has_history" as const,
        blockers: result.blockers,
      };
    }
    return { deleted: true, name: result.name, email: result.email };
  },
});
