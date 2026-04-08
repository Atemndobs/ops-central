import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type DbCtx = QueryCtx | MutationCtx;

function normalizePreview(body: string): string {
  const compact = body.trim().replace(/\s+/g, " ");
  if (compact.length <= 140) {
    return compact;
  }
  return `${compact.slice(0, 137)}...`;
}

export function buildConversationPreview(body: string): string {
  return normalizePreview(body);
}

export function isPrivilegedRole(role: Doc<"users">["role"]): boolean {
  return role === "admin" || role === "manager" || role === "property_ops";
}

export async function getJobConversationByJobId(
  ctx: DbCtx,
  jobId: Id<"cleaningJobs">,
) {
  return await ctx.db
    .query("conversations")
    .withIndex("by_linked_job", (q) => q.eq("linkedJobId", jobId))
    .first();
}

export async function getConversationParticipant(
  ctx: DbCtx,
  conversationId: Id<"conversations">,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("conversationParticipants")
    .withIndex("by_conversation_and_user", (q) =>
      q.eq("conversationId", conversationId).eq("userId", userId),
    )
    .first();
}

export async function ensureConversationParticipant(
  ctx: MutationCtx,
  args: {
    conversationId: Id<"conversations">;
    userId: Id<"users">;
    markReadAt?: number;
  },
) {
  const existing = await getConversationParticipant(
    ctx,
    args.conversationId,
    args.userId,
  );
  const now = Date.now();

  if (existing) {
    const updates: Partial<Doc<"conversationParticipants">> = {
      updatedAt: now,
    };
    if (
      typeof args.markReadAt === "number" &&
      (existing.lastReadMessageAt ?? 0) < args.markReadAt
    ) {
      updates.lastReadMessageAt = args.markReadAt;
    }
    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(existing._id, updates);
    }
    return existing._id;
  }

  return await ctx.db.insert("conversationParticipants", {
    conversationId: args.conversationId,
    userId: args.userId,
    participantKind: "user",
    lastReadMessageAt: args.markReadAt,
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

export async function seedJobConversationParticipants(
  ctx: MutationCtx,
  args: {
    conversationId: Id<"conversations">;
    job: Doc<"cleaningJobs">;
  },
) {
  const propertyOpsAssignments = await ctx.db
    .query("propertyOpsAssignments")
    .withIndex("by_property", (q) => q.eq("propertyId", args.job.propertyId))
    .collect();
  const admins = await ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", "admin"))
    .collect();

  const participantIds = new Set<Id<"users">>(args.job.assignedCleanerIds);
  if (args.job.assignedManagerId) {
    participantIds.add(args.job.assignedManagerId);
  }
  propertyOpsAssignments.forEach((assignment) => participantIds.add(assignment.userId));
  admins.forEach((admin) => participantIds.add(admin._id));

  await Promise.all(
    [...participantIds].map((userId) =>
      ensureConversationParticipant(ctx, {
        conversationId: args.conversationId,
        userId,
      }),
    ),
  );
}

export async function canAccessJobConversation(
  ctx: DbCtx,
  args: {
    user: Doc<"users">;
    job: Doc<"cleaningJobs">;
  },
) {
  if (args.user.role === "admin") {
    return true;
  }

  if (
    args.user.role === "cleaner" &&
    args.job.assignedCleanerIds.includes(args.user._id)
  ) {
    return true;
  }

  if (args.user.role === "property_ops" || args.user.role === "manager") {
    return true;
  }

  return false;
}

export async function assertConversationAccess(
  ctx: DbCtx,
  args: {
    user: Doc<"users">;
    conversation: Doc<"conversations">;
  },
) {
  const participant = await getConversationParticipant(
    ctx,
    args.conversation._id,
    args.user._id,
  );
  if (participant) {
    return participant;
  }

  if (!args.conversation.linkedJobId) {
    throw new ConvexError("You are not authorized to access this conversation.");
  }

  const job = await ctx.db.get(args.conversation.linkedJobId);
  if (!job) {
    throw new ConvexError("Linked job not found.");
  }

  const canAccess = await canAccessJobConversation(ctx, {
    user: args.user,
    job,
  });

  if (!canAccess) {
    throw new ConvexError("You are not authorized to access this conversation.");
  }

  return null;
}

export async function syncConversationStatusForJob(
  ctx: MutationCtx,
  args: {
    jobId: Id<"cleaningJobs">;
    nextStatus: Doc<"cleaningJobs">["status"];
  },
) {
  const conversation = await getJobConversationByJobId(ctx, args.jobId);
  if (!conversation) {
    return null;
  }

  const status =
    args.nextStatus === "completed" || args.nextStatus === "cancelled"
      ? "closed"
      : "open";

  if (conversation.status === status) {
    return conversation._id;
  }

  await ctx.db.patch(conversation._id, {
    status,
    updatedAt: Date.now(),
  });

  return conversation._id;
}
