import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type DbCtx = QueryCtx | MutationCtx;

export type ConversationLaneKind = "internal_shared" | "whatsapp_cleaner";

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

export function getConversationLaneKind(
  conversation: Pick<
    Doc<"conversations">,
    "laneKind" | "channel" | "linkedCleanerId"
  >,
): ConversationLaneKind {
  if (conversation.laneKind === "whatsapp_cleaner") {
    return "whatsapp_cleaner";
  }

  if (
    conversation.channel === "whatsapp" &&
    conversation.linkedCleanerId !== undefined
  ) {
    return "whatsapp_cleaner";
  }

  return "internal_shared";
}

export function isWhatsAppConversation(
  conversation: Pick<
    Doc<"conversations">,
    "laneKind" | "channel" | "linkedCleanerId"
  >,
) {
  return getConversationLaneKind(conversation) === "whatsapp_cleaner";
}

export async function getJobConversationsByJobId(
  ctx: DbCtx,
  jobId: Id<"cleaningJobs">,
) {
  return await ctx.db
    .query("conversations")
    .withIndex("by_linked_job", (q) => q.eq("linkedJobId", jobId))
    .collect();
}

export async function getJobConversationByJobId(
  ctx: DbCtx,
  jobId: Id<"cleaningJobs">,
) {
  const conversations = await getJobConversationsByJobId(ctx, jobId);
  return (
    conversations.find((conversation) => {
      const laneKind = getConversationLaneKind(conversation);
      return (
        laneKind === "internal_shared" && conversation.channel === "internal"
      );
    }) ?? null
  );
}

export async function getWhatsAppConversationByJobAndCleaner(
  ctx: DbCtx,
  args: {
    jobId: Id<"cleaningJobs">;
    cleanerUserId: Id<"users">;
  },
) {
  return await ctx.db
    .query("conversations")
    .withIndex("by_linked_job_and_lane_kind_and_linked_cleaner", (q) =>
      q
        .eq("linkedJobId", args.jobId)
        .eq("laneKind", "whatsapp_cleaner")
        .eq("linkedCleanerId", args.cleanerUserId),
    )
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

export async function getConversationEndpointParticipant(
  ctx: DbCtx,
  conversationId: Id<"conversations">,
  endpointId: Id<"messagingEndpoints">,
) {
  return await ctx.db
    .query("conversationParticipants")
    .withIndex("by_conversation_and_messaging_endpoint", (q) =>
      q
        .eq("conversationId", conversationId)
        .eq("messagingEndpointId", endpointId),
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
    await ctx.db.patch(existing._id, updates);
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

export async function ensureExternalEndpointParticipant(
  ctx: MutationCtx,
  args: {
    conversationId: Id<"conversations">;
    endpointId: Id<"messagingEndpoints">;
    externalDisplayName?: string;
  },
) {
  const existing = await getConversationEndpointParticipant(
    ctx,
    args.conversationId,
    args.endpointId,
  );
  const now = Date.now();

  if (existing) {
    await ctx.db.patch(existing._id, {
      externalDisplayName: args.externalDisplayName ?? existing.externalDisplayName,
      updatedAt: now,
    });
    return existing._id;
  }

  return await ctx.db.insert("conversationParticipants", {
    conversationId: args.conversationId,
    messagingEndpointId: args.endpointId,
    participantKind: "external_contact",
    externalDisplayName: args.externalDisplayName,
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

async function listPrivilegedParticipantIdsForJob(
  ctx: MutationCtx,
  job: Doc<"cleaningJobs">,
) {
  const propertyOpsAssignments = await ctx.db
    .query("propertyOpsAssignments")
    .withIndex("by_property", (q) => q.eq("propertyId", job.propertyId))
    .collect();
  const admins = await ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", "admin"))
    .collect();

  const participantIds = new Set<Id<"users">>();
  if (job.assignedManagerId) {
    participantIds.add(job.assignedManagerId);
  }
  propertyOpsAssignments.forEach((assignment) =>
    participantIds.add(assignment.userId),
  );
  admins.forEach((admin) => participantIds.add(admin._id));

  return [...participantIds];
}

export async function seedJobConversationParticipants(
  ctx: MutationCtx,
  args: {
    conversationId: Id<"conversations">;
    job: Doc<"cleaningJobs">;
    laneKind?: ConversationLaneKind;
    endpointId?: Id<"messagingEndpoints">;
    endpointDisplayName?: string;
  },
) {
  const laneKind = args.laneKind ?? "internal_shared";
  const participantIds = new Set<Id<"users">>();

  if (laneKind === "internal_shared") {
    args.job.assignedCleanerIds.forEach((userId) => participantIds.add(userId));
  }

  const privilegedIds = await listPrivilegedParticipantIdsForJob(ctx, args.job);
  privilegedIds.forEach((userId) => participantIds.add(userId));

  await Promise.all(
    [...participantIds].map((userId) =>
      ensureConversationParticipant(ctx, {
        conversationId: args.conversationId,
        userId,
      }),
    ),
  );

  if (laneKind === "whatsapp_cleaner" && args.endpointId) {
    await ensureExternalEndpointParticipant(ctx, {
      conversationId: args.conversationId,
      endpointId: args.endpointId,
      externalDisplayName: args.endpointDisplayName,
    });
  }
}

export async function canAccessJobConversation(
  ctx: DbCtx,
  args: {
    user: Doc<"users">;
    job: Doc<"cleaningJobs">;
    conversation?: Doc<"conversations">;
  },
) {
  const laneKind = args.conversation
    ? getConversationLaneKind(args.conversation)
    : "internal_shared";

  if (args.user.role === "admin") {
    return true;
  }

  if (laneKind === "whatsapp_cleaner") {
    return isPrivilegedRole(args.user.role);
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
    conversation: args.conversation,
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
  const conversations = await getJobConversationsByJobId(ctx, args.jobId);
  if (conversations.length === 0) {
    return [];
  }

  const status =
    args.nextStatus === "completed" || args.nextStatus === "cancelled"
      ? "closed"
      : "open";

  const now = Date.now();
  const updatedIds: Id<"conversations">[] = [];

  for (const conversation of conversations) {
    if (conversation.status === status) {
      updatedIds.push(conversation._id);
      continue;
    }

    await ctx.db.patch(conversation._id, {
      status,
      updatedAt: now,
    });
    updatedIds.push(conversation._id);
  }

  return updatedIds;
}
