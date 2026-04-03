import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireRole } from "../lib/auth";
import { readProfileOverrides } from "../lib/profileMetadata";

const userRoleValidator = v.union(
  v.literal("cleaner"),
  v.literal("manager"),
  v.literal("property_ops"),
  v.literal("admin"),
);

const clerkDirectoryUserValidator = v.object({
  clerkId: v.string(),
  email: v.string(),
  name: v.optional(v.string()),
  role: v.optional(userRoleValidator),
  avatarUrl: v.optional(v.string()),
});

type ClerkDirectoryUser = {
  clerkId: string;
  email: string;
  name?: string;
  role?: Doc<"users">["role"];
  avatarUrl?: string;
};

type ReferenceSummary = {
  total: number;
  userRolesUserId: number;
  userRolesGrantedBy: number;
  cleaningCompaniesOwnerId: number;
  companyMembersUserId: number;
  companyPropertiesAssignedBy: number;
  propertyOpsAssignmentsUserId: number;
  propertyOpsAssignmentsAssignedBy: number;
  cleaningJobsAssignedCleaner: number;
  cleaningJobsAssignedManager: number;
  cleaningJobsApprovedBy: number;
  cleaningJobsRejectedBy: number;
  photosUploadedBy: number;
  incidentsReportedBy: number;
  incidentsResolvedBy: number;
  inventoryItemsLastCheckedBy: number;
  stockChecksCheckedBy: number;
  notificationsUserId: number;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertWebhookToken(webhookToken: string | undefined) {
  const expectedWebhookToken = process.env.CLERK_WEBHOOK_SYNC_TOKEN;
  if (!expectedWebhookToken) {
    throw new ConvexError(
      "CLERK_WEBHOOK_SYNC_TOKEN is not configured in Convex.",
    );
  }
  if (webhookToken !== expectedWebhookToken) {
    throw new ConvexError("Invalid webhook token.");
  }
}

function emptyReferenceSummary(): ReferenceSummary {
  return {
    total: 0,
    userRolesUserId: 0,
    userRolesGrantedBy: 0,
    cleaningCompaniesOwnerId: 0,
    companyMembersUserId: 0,
    companyPropertiesAssignedBy: 0,
    propertyOpsAssignmentsUserId: 0,
    propertyOpsAssignmentsAssignedBy: 0,
    cleaningJobsAssignedCleaner: 0,
    cleaningJobsAssignedManager: 0,
    cleaningJobsApprovedBy: 0,
    cleaningJobsRejectedBy: 0,
    photosUploadedBy: 0,
    incidentsReportedBy: 0,
    incidentsResolvedBy: 0,
    inventoryItemsLastCheckedBy: 0,
    stockChecksCheckedBy: 0,
    notificationsUserId: 0,
  };
}

function calculateReferenceTotal(summary: ReferenceSummary): number {
  return (
    summary.userRolesUserId +
    summary.userRolesGrantedBy +
    summary.cleaningCompaniesOwnerId +
    summary.companyMembersUserId +
    summary.companyPropertiesAssignedBy +
    summary.propertyOpsAssignmentsUserId +
    summary.propertyOpsAssignmentsAssignedBy +
    summary.cleaningJobsAssignedCleaner +
    summary.cleaningJobsAssignedManager +
    summary.cleaningJobsApprovedBy +
    summary.cleaningJobsRejectedBy +
    summary.photosUploadedBy +
    summary.incidentsReportedBy +
    summary.incidentsResolvedBy +
    summary.inventoryItemsLastCheckedBy +
    summary.stockChecksCheckedBy +
    summary.notificationsUserId
  );
}

async function countUserReferences(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<ReferenceSummary> {
  const summary = emptyReferenceSummary();

  const userRolesByUser = await ctx.db
    .query("userRoles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  summary.userRolesUserId = userRolesByUser.length;

  const allUserRoles = await ctx.db.query("userRoles").collect();
  summary.userRolesGrantedBy = allUserRoles.filter(
    (row) => row.grantedBy === userId,
  ).length;

  const companiesByOwner = await ctx.db
    .query("cleaningCompanies")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  summary.cleaningCompaniesOwnerId = companiesByOwner.length;

  const companyMembersByUser = await ctx.db
    .query("companyMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  summary.companyMembersUserId = companyMembersByUser.length;

  const allCompanyProperties = await ctx.db.query("companyProperties").collect();
  summary.companyPropertiesAssignedBy = allCompanyProperties.filter(
    (row) => row.assignedBy === userId,
  ).length;

  const propertyOpsByUser = await ctx.db
    .query("propertyOpsAssignments")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  summary.propertyOpsAssignmentsUserId = propertyOpsByUser.length;

  const allPropertyOps = await ctx.db.query("propertyOpsAssignments").collect();
  summary.propertyOpsAssignmentsAssignedBy = allPropertyOps.filter(
    (row) => row.assignedBy === userId,
  ).length;

  const allJobs = await ctx.db.query("cleaningJobs").collect();
  summary.cleaningJobsAssignedCleaner = allJobs.filter((job) =>
    job.assignedCleanerIds.includes(userId),
  ).length;
  summary.cleaningJobsAssignedManager = allJobs.filter(
    (job) => job.assignedManagerId === userId,
  ).length;
  summary.cleaningJobsApprovedBy = allJobs.filter(
    (job) => job.approvedBy === userId,
  ).length;
  summary.cleaningJobsRejectedBy = allJobs.filter(
    (job) => job.rejectedBy === userId,
  ).length;

  const allPhotos = await ctx.db.query("photos").collect();
  summary.photosUploadedBy = allPhotos.filter(
    (row) => row.uploadedBy === userId,
  ).length;

  const allIncidents = await ctx.db.query("incidents").collect();
  summary.incidentsReportedBy = allIncidents.filter(
    (row) => row.reportedBy === userId,
  ).length;
  summary.incidentsResolvedBy = allIncidents.filter(
    (row) => row.resolvedBy === userId,
  ).length;

  const allInventoryItems = await ctx.db.query("inventoryItems").collect();
  summary.inventoryItemsLastCheckedBy = allInventoryItems.filter(
    (row) => row.lastCheckedBy === userId,
  ).length;

  const allStockChecks = await ctx.db.query("stockChecks").collect();
  summary.stockChecksCheckedBy = allStockChecks.filter(
    (row) => row.checkedBy === userId,
  ).length;

  const notificationsByUser = await ctx.db
    .query("notifications")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  summary.notificationsUserId = notificationsByUser.length;

  summary.total = calculateReferenceTotal(summary);
  return summary;
}

async function reassignUserReferences(
  ctx: MutationCtx,
  fromUserId: Id<"users">,
  toUserId: Id<"users">,
): Promise<ReferenceSummary> {
  const summary = emptyReferenceSummary();

  const userRolesByUser = await ctx.db
    .query("userRoles")
    .withIndex("by_user", (q) => q.eq("userId", fromUserId))
    .collect();
  for (const row of userRolesByUser) {
    await ctx.db.patch(row._id, { userId: toUserId });
  }
  summary.userRolesUserId = userRolesByUser.length;

  const allUserRoles = await ctx.db.query("userRoles").collect();
  for (const row of allUserRoles) {
    if (row.grantedBy === fromUserId) {
      await ctx.db.patch(row._id, { grantedBy: toUserId });
      summary.userRolesGrantedBy += 1;
    }
  }

  const companiesByOwner = await ctx.db
    .query("cleaningCompanies")
    .withIndex("by_owner", (q) => q.eq("ownerId", fromUserId))
    .collect();
  for (const row of companiesByOwner) {
    await ctx.db.patch(row._id, { ownerId: toUserId });
  }
  summary.cleaningCompaniesOwnerId = companiesByOwner.length;

  const companyMembersByUser = await ctx.db
    .query("companyMembers")
    .withIndex("by_user", (q) => q.eq("userId", fromUserId))
    .collect();
  for (const row of companyMembersByUser) {
    await ctx.db.patch(row._id, { userId: toUserId });
  }
  summary.companyMembersUserId = companyMembersByUser.length;

  const allCompanyProperties = await ctx.db.query("companyProperties").collect();
  for (const row of allCompanyProperties) {
    if (row.assignedBy === fromUserId) {
      await ctx.db.patch(row._id, { assignedBy: toUserId });
      summary.companyPropertiesAssignedBy += 1;
    }
  }

  const propertyOpsByUser = await ctx.db
    .query("propertyOpsAssignments")
    .withIndex("by_user", (q) => q.eq("userId", fromUserId))
    .collect();
  for (const row of propertyOpsByUser) {
    await ctx.db.patch(row._id, { userId: toUserId });
  }
  summary.propertyOpsAssignmentsUserId = propertyOpsByUser.length;

  const allPropertyOps = await ctx.db.query("propertyOpsAssignments").collect();
  for (const row of allPropertyOps) {
    if (row.assignedBy === fromUserId) {
      await ctx.db.patch(row._id, { assignedBy: toUserId });
      summary.propertyOpsAssignmentsAssignedBy += 1;
    }
  }

  const allJobs = await ctx.db.query("cleaningJobs").collect();
  for (const row of allJobs) {
    const updates: Partial<Doc<"cleaningJobs">> = {};
    let changed = false;

    if (row.assignedManagerId === fromUserId) {
      updates.assignedManagerId = toUserId;
      summary.cleaningJobsAssignedManager += 1;
      changed = true;
    }

    if (row.assignedCleanerIds.includes(fromUserId)) {
      updates.assignedCleanerIds = row.assignedCleanerIds.map((cleanerId) =>
        cleanerId === fromUserId ? toUserId : cleanerId,
      );
      summary.cleaningJobsAssignedCleaner += 1;
      changed = true;
    }

    if (row.approvedBy === fromUserId) {
      updates.approvedBy = toUserId;
      summary.cleaningJobsApprovedBy += 1;
      changed = true;
    }

    if (row.rejectedBy === fromUserId) {
      updates.rejectedBy = toUserId;
      summary.cleaningJobsRejectedBy += 1;
      changed = true;
    }

    if (changed) {
      updates.updatedAt = Date.now();
      await ctx.db.patch(row._id, updates);
    }
  }

  const allPhotos = await ctx.db.query("photos").collect();
  for (const row of allPhotos) {
    if (row.uploadedBy === fromUserId) {
      await ctx.db.patch(row._id, { uploadedBy: toUserId });
      summary.photosUploadedBy += 1;
    }
  }

  const allIncidents = await ctx.db.query("incidents").collect();
  for (const row of allIncidents) {
    const updates: Partial<Doc<"incidents">> = {};
    let changed = false;

    if (row.reportedBy === fromUserId) {
      updates.reportedBy = toUserId;
      summary.incidentsReportedBy += 1;
      changed = true;
    }
    if (row.resolvedBy === fromUserId) {
      updates.resolvedBy = toUserId;
      summary.incidentsResolvedBy += 1;
      changed = true;
    }

    if (changed) {
      updates.updatedAt = Date.now();
      await ctx.db.patch(row._id, updates);
    }
  }

  const allInventoryItems = await ctx.db.query("inventoryItems").collect();
  for (const row of allInventoryItems) {
    if (row.lastCheckedBy === fromUserId) {
      await ctx.db.patch(row._id, {
        lastCheckedBy: toUserId,
        updatedAt: Date.now(),
      });
      summary.inventoryItemsLastCheckedBy += 1;
    }
  }

  const allStockChecks = await ctx.db.query("stockChecks").collect();
  for (const row of allStockChecks) {
    if (row.checkedBy === fromUserId) {
      await ctx.db.patch(row._id, { checkedBy: toUserId });
      summary.stockChecksCheckedBy += 1;
    }
  }

  const notificationsByUser = await ctx.db
    .query("notifications")
    .withIndex("by_user", (q) => q.eq("userId", fromUserId))
    .collect();
  for (const row of notificationsByUser) {
    await ctx.db.patch(row._id, { userId: toUserId });
  }
  summary.notificationsUserId = notificationsByUser.length;

  summary.total = calculateReferenceTotal(summary);
  return summary;
}

export const reconcileWithClerk = mutation({
  args: {
    clerkUsers: v.array(clerkDirectoryUserValidator),
    dryRun: v.optional(v.boolean()),
    pruneUnmatched: v.optional(v.boolean()),
    webhookToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.webhookToken) {
      assertWebhookToken(args.webhookToken);
    } else {
      await requireRole(ctx, ["admin"]);
    }

    if (args.clerkUsers.length === 0) {
      throw new ConvexError(
        "Cannot reconcile users with an empty Clerk directory.",
      );
    }

    const dryRun = args.dryRun ?? true;
    const pruneUnmatched = args.pruneUnmatched ?? false;
    const now = Date.now();

    const clerkUsersByClerkId = new Map<string, ClerkDirectoryUser>();
    const clerkUsersByEmail = new Map<string, ClerkDirectoryUser>();

    for (const directoryUser of args.clerkUsers) {
      const normalizedEmail = normalizeEmail(directoryUser.email);
      if (!normalizedEmail) {
        throw new ConvexError("Every Clerk directory user must include email.");
      }
      if (clerkUsersByClerkId.has(directoryUser.clerkId)) {
        throw new ConvexError(
          `Duplicate Clerk ID in directory input: ${directoryUser.clerkId}`,
        );
      }
      const emailMatch = clerkUsersByEmail.get(normalizedEmail);
      if (emailMatch && emailMatch.clerkId !== directoryUser.clerkId) {
        throw new ConvexError(
          `Duplicate email with different Clerk IDs in directory input: ${normalizedEmail}`,
        );
      }
      clerkUsersByClerkId.set(directoryUser.clerkId, directoryUser);
      clerkUsersByEmail.set(normalizedEmail, directoryUser);
    }

    const users = await ctx.db.query("users").collect();
    const usersByClerkId = new Map<string, Doc<"users">>();
    for (const user of users) {
      usersByClerkId.set(user.clerkId, user);
    }

    const deletedUserIds = new Set<Id<"users">>();

    const updatedUsers: Array<{ userId: Id<"users">; clerkId: string }> = [];
    const relinkedUsers: Array<{
      userId: Id<"users">;
      fromClerkId: string;
      toClerkId: string;
    }> = [];
    const mergedUsers: Array<{
      deletedUserId: Id<"users">;
      targetUserId: Id<"users">;
      referencesMoved: ReferenceSummary;
    }> = [];
    const createdMissingUsers: Array<{
      userId: Id<"users">;
      clerkId: string;
      email: string;
    }> = [];
    const deletedUnmatchedUsers: Array<{ userId: Id<"users">; email: string }> =
      [];
    const unmatchedUsersKept: Array<{
      userId: Id<"users">;
      email: string;
      clerkId: string;
      references: ReferenceSummary;
    }> = [];

    for (const user of users) {
      if (deletedUserIds.has(user._id)) {
        continue;
      }

      const canonicalByClerkId = clerkUsersByClerkId.get(user.clerkId);
      if (canonicalByClerkId) {
        const profileOverrides = readProfileOverrides(user.metadata);
        const updates: Partial<Doc<"users">> = {};
        if (normalizeEmail(user.email) !== normalizeEmail(canonicalByClerkId.email)) {
          updates.email = canonicalByClerkId.email;
        }
        if (
          !profileOverrides.name &&
          canonicalByClerkId.name &&
          canonicalByClerkId.name !== user.name
        ) {
          updates.name = canonicalByClerkId.name;
        }
        if (canonicalByClerkId.role && canonicalByClerkId.role !== user.role) {
          updates.role = canonicalByClerkId.role;
        }
        if (
          !profileOverrides.avatarUrl &&
          canonicalByClerkId.avatarUrl !== undefined
        ) {
          if (canonicalByClerkId.avatarUrl !== user.avatarUrl) {
            updates.avatarUrl = canonicalByClerkId.avatarUrl;
          }
        }

        if (Object.keys(updates).length > 0) {
          updates.updatedAt = now;
          if (!dryRun) {
            await ctx.db.patch(user._id, updates);
          }
          updatedUsers.push({ userId: user._id, clerkId: user.clerkId });
        }
        continue;
      }

      const canonicalByEmail = clerkUsersByEmail.get(normalizeEmail(user.email));
      if (!canonicalByEmail) {
        const references = await countUserReferences(ctx, user._id);
        if (pruneUnmatched && references.total === 0) {
          if (!dryRun) {
            await ctx.db.delete(user._id);
          }
          deletedUserIds.add(user._id);
          deletedUnmatchedUsers.push({ userId: user._id, email: user.email });
        } else {
          unmatchedUsersKept.push({
            userId: user._id,
            email: user.email,
            clerkId: user.clerkId,
            references,
          });
        }
        continue;
      }

      const targetUser = usersByClerkId.get(canonicalByEmail.clerkId);
      if (targetUser && targetUser._id !== user._id) {
        const referencesMoved = dryRun
          ? await countUserReferences(ctx, user._id)
          : await reassignUserReferences(ctx, user._id, targetUser._id);
        if (!dryRun) {
          await ctx.db.delete(user._id);
        }
        deletedUserIds.add(user._id);
        mergedUsers.push({
          deletedUserId: user._id,
          targetUserId: targetUser._id,
          referencesMoved,
        });
        continue;
      }

      const updates: Partial<Doc<"users">> = {
        clerkId: canonicalByEmail.clerkId,
        email: canonicalByEmail.email,
        updatedAt: now,
      };
      const profileOverrides = readProfileOverrides(user.metadata);
      if (canonicalByEmail.name) {
        if (!profileOverrides.name) {
          updates.name = canonicalByEmail.name;
        }
      }
      if (canonicalByEmail.role) {
        updates.role = canonicalByEmail.role;
      }
      if (
        !profileOverrides.avatarUrl &&
        canonicalByEmail.avatarUrl !== undefined
      ) {
        updates.avatarUrl = canonicalByEmail.avatarUrl;
      }

      if (!dryRun) {
        await ctx.db.patch(user._id, updates);
      }

      usersByClerkId.delete(user.clerkId);
      usersByClerkId.set(canonicalByEmail.clerkId, {
        ...user,
        ...updates,
      });

      relinkedUsers.push({
        userId: user._id,
        fromClerkId: user.clerkId,
        toClerkId: canonicalByEmail.clerkId,
      });
    }

    let finalUsers = await ctx.db.query("users").collect();
    let finalClerkIds = new Set(finalUsers.map((user) => user.clerkId));
    let missingInConvex = args.clerkUsers.filter(
      (directoryUser) => !finalClerkIds.has(directoryUser.clerkId),
    );

    if (!dryRun && missingInConvex.length > 0) {
      for (const directoryUser of missingInConvex) {
        const userId = await ctx.db.insert("users", {
          clerkId: directoryUser.clerkId,
          email: directoryUser.email,
          name: directoryUser.name,
          role: directoryUser.role ?? "cleaner",
          avatarUrl: directoryUser.avatarUrl,
          createdAt: now,
          updatedAt: now,
        });
        createdMissingUsers.push({
          userId,
          clerkId: directoryUser.clerkId,
          email: directoryUser.email,
        });
      }

      finalUsers = await ctx.db.query("users").collect();
      finalClerkIds = new Set(finalUsers.map((user) => user.clerkId));
      missingInConvex = args.clerkUsers.filter(
        (directoryUser) => !finalClerkIds.has(directoryUser.clerkId),
      );
    }

    return {
      dryRun,
      pruneUnmatched,
      totalConvexUsersBefore: users.length,
      totalConvexUsersAfter: dryRun ? users.length : finalUsers.length,
      updatedUsers,
      relinkedUsers,
      mergedUsers,
      createdMissingUsers,
      deletedUnmatchedUsers,
      unmatchedUsersKept,
      missingInConvex,
    };
  },
});
