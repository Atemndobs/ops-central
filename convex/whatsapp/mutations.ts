import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { createNotificationsForUsers } from "../lib/opsNotifications";
import { getCurrentUser } from "../lib/auth";
import {
  buildConversationPreview,
  ensureConversationParticipant,
  ensureExternalEndpointParticipant,
  getConversationParticipant,
  getWhatsAppConversationByJobAndCleaner,
  isPrivilegedRole,
  seedJobConversationParticipants,
} from "../conversations/lib";
import { getWhatsAppServiceWindowClosesAt } from "./lib";

function requirePrivilegedUser(user: Doc<"users">) {
  if (!isPrivilegedRole(user.role)) {
    throw new ConvexError("Only privileged users can manage WhatsApp lanes.");
  }
}

async function findEndpointByAddress(
  ctx: MutationCtx,
  args: { waId: string; phoneNumber: string | null },
) {
  const endpointByWaId = await ctx.db
    .query("messagingEndpoints")
    .withIndex("by_channel_and_wa_id", (q) =>
      q.eq("channel", "whatsapp").eq("waId", args.waId),
    )
    .first();

  if (endpointByWaId) {
    return endpointByWaId;
  }

  if (!args.phoneNumber) {
    return null;
  }

  return await ctx.db
    .query("messagingEndpoints")
    .withIndex("by_channel_and_phone_number", (q) =>
      q.eq("channel", "whatsapp").eq("phoneNumber", args.phoneNumber!),
    )
    .first();
}

async function upsertTransportEvent(
  ctx: MutationCtx,
  args: {
    idempotencyKey: string;
    providerMessageId?: string;
    conversationId?: Id<"conversations">;
    messageId?: Id<"conversationMessages">;
    endpointId?: Id<"messagingEndpoints">;
    direction: "inbound" | "outbound";
    currentStatus:
      | "queued"
      | "received"
      | "sent"
      | "delivered"
      | "read"
      | "failed";
    errorCode?: string;
    errorMessage?: string;
    payload?: unknown;
    occurredAt?: number;
  },
) {
  const existingByKey = await ctx.db
    .query("messageTransportEvents")
    .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
    .first();
  const existingByProviderMessage =
    args.providerMessageId
      ? await ctx.db
          .query("messageTransportEvents")
          .withIndex("by_provider_and_provider_message_id", (q) =>
            q
              .eq("provider", "meta_whatsapp")
              .eq("providerMessageId", args.providerMessageId),
          )
          .first()
      : null;

  const existing = existingByKey ?? existingByProviderMessage;
  const now = Date.now();

  if (existing) {
    await ctx.db.patch(existing._id, {
      conversationId: args.conversationId ?? existing.conversationId,
      messageId: args.messageId ?? existing.messageId,
      endpointId: args.endpointId ?? existing.endpointId,
      providerMessageId: args.providerMessageId ?? existing.providerMessageId,
      currentStatus: args.currentStatus,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
      payload: args.payload ?? existing.payload,
      updatedAt: now,
      lastEventAt: args.occurredAt ?? now,
    });
    return existing._id;
  }

  return await ctx.db.insert("messageTransportEvents", {
    conversationId: args.conversationId,
    messageId: args.messageId,
    endpointId: args.endpointId,
    provider: "meta_whatsapp",
    providerMessageId: args.providerMessageId,
    direction: args.direction,
    currentStatus: args.currentStatus,
    idempotencyKey: args.idempotencyKey,
    errorCode: args.errorCode,
    errorMessage: args.errorMessage,
    payload: args.payload,
    createdAt: now,
    updatedAt: now,
    lastEventAt: args.occurredAt ?? now,
  });
}

async function listLaneRecipientIds(
  ctx: MutationCtx,
  conversationId: Id<"conversations">,
) {
  const participants = await ctx.db
    .query("conversationParticipants")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
    .collect();

  return [
    ...new Set(
      participants
        .filter((participant) => participant.userId && participant.mutedAt === undefined)
        .map((participant) => participant.userId!),
    ),
  ];
}

async function getOrCreateWhatsAppLane(
  ctx: MutationCtx,
  args: {
    job: Doc<"cleaningJobs">;
    cleanerUserId: Id<"users">;
    endpointId?: Id<"messagingEndpoints">;
    endpointDisplayName?: string;
    createdBy: Id<"users">;
  },
) {
  const now = Date.now();
  let conversation = await getWhatsAppConversationByJobAndCleaner(ctx, {
    jobId: args.job._id,
    cleanerUserId: args.cleanerUserId,
  });

  if (!conversation) {
    const conversationId = await ctx.db.insert("conversations", {
      linkedJobId: args.job._id,
      propertyId: args.job.propertyId,
      laneKind: "whatsapp_cleaner",
      linkedCleanerId: args.cleanerUserId,
      messagingEndpointId: args.endpointId,
      channel: "whatsapp",
      kind: "job",
      status:
        args.job.status === "completed" || args.job.status === "cancelled"
          ? "closed"
          : "open",
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    conversation = await ctx.db.get(conversationId);
  } else if (
    args.endpointId &&
    conversation.messagingEndpointId !== args.endpointId
  ) {
    await ctx.db.patch(conversation._id, {
      messagingEndpointId: args.endpointId,
      updatedAt: now,
    });
    conversation = await ctx.db.get(conversation._id);
  }

  if (!conversation) {
    throw new ConvexError("Unable to create WhatsApp lane.");
  }

  await seedJobConversationParticipants(ctx, {
    conversationId: conversation._id,
    job: args.job,
    laneKind: "whatsapp_cleaner",
    endpointId: args.endpointId,
    endpointDisplayName: args.endpointDisplayName,
  });

  return conversation;
}

async function redeemInviteAndResolveLane(
  ctx: MutationCtx,
  args: {
    inviteToken: string;
    existingEndpoint: Doc<"messagingEndpoints"> | null;
    waId: string;
    phoneNumber: string;
    profileName?: string;
    occurredAt: number;
  },
) {
  const invite = await ctx.db
    .query("whatsappLaneInvites")
    .withIndex("by_token", (q) => q.eq("token", args.inviteToken))
    .first();

  if (!invite) {
    throw new ConvexError("WhatsApp invite token is invalid.");
  }

  if (
    invite.redeemedAt !== undefined &&
    invite.redeemedWaId !== undefined &&
    invite.redeemedWaId !== args.waId
  ) {
    throw new ConvexError("WhatsApp invite token has already been redeemed.");
  }

  if (invite.expiresAt < Date.now()) {
    throw new ConvexError("WhatsApp invite token has expired.");
  }

  const [job, cleaner] = await Promise.all([
    ctx.db.get(invite.jobId),
    ctx.db.get(invite.cleanerUserId),
  ]);
  if (!job || !cleaner) {
    throw new ConvexError("WhatsApp invite is missing its linked job or cleaner.");
  }

  let endpoint = args.existingEndpoint;
  if (endpoint && endpoint.userId !== cleaner._id) {
    throw new ConvexError("Incoming WhatsApp number is already linked to another cleaner.");
  }

  if (!endpoint) {
    endpoint = await ctx.db
      .query("messagingEndpoints")
      .withIndex("by_user_and_channel", (q) =>
        q.eq("userId", cleaner._id).eq("channel", "whatsapp"),
      )
      .first();
  }

  const serviceWindowClosesAt = getWhatsAppServiceWindowClosesAt(args.occurredAt);
  const now = Date.now();

  if (endpoint) {
    await ctx.db.patch(endpoint._id, {
      waId: args.waId,
      phoneNumber: args.phoneNumber,
      displayName: args.profileName ?? endpoint.displayName,
      lastInboundAt: args.occurredAt,
      serviceWindowClosesAt,
      status: "active",
      updatedAt: now,
    });
    endpoint = await ctx.db.get(endpoint._id);
  } else {
    const endpointId = await ctx.db.insert("messagingEndpoints", {
      userId: cleaner._id,
      channel: "whatsapp",
      waId: args.waId,
      phoneNumber: args.phoneNumber,
      displayName: args.profileName,
      optedInAt: args.occurredAt,
      lastInboundAt: args.occurredAt,
      serviceWindowClosesAt,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    endpoint = await ctx.db.get(endpointId);
  }

  if (!endpoint) {
    throw new ConvexError("Unable to bind a WhatsApp endpoint.");
  }

  const conversation = await getOrCreateWhatsAppLane(ctx, {
    job,
    cleanerUserId: cleaner._id,
    endpointId: endpoint._id,
    endpointDisplayName: endpoint.displayName,
    createdBy: invite.createdBy,
  });

  await Promise.all([
    ctx.db.patch(endpoint._id, {
      activeConversationId: conversation._id,
      updatedAt: now,
    }),
    ctx.db.patch(invite._id, {
      conversationId: conversation._id,
      redeemedAt: invite.redeemedAt ?? now,
      redeemedEndpointId: endpoint._id,
      redeemedWaId: args.waId,
      updatedAt: now,
    }),
  ]);

  return {
    endpoint,
    conversation,
  };
}

async function resolveInboundConversation(
  ctx: MutationCtx,
  args: {
    waId: string;
    phoneNumber: string;
    profileName?: string;
    inviteToken?: string;
    occurredAt: number;
  },
) {
  const existingEndpoint = await findEndpointByAddress(ctx, {
    waId: args.waId,
    phoneNumber: args.phoneNumber,
  });

  if (args.inviteToken) {
    return await redeemInviteAndResolveLane(ctx, {
      inviteToken: args.inviteToken,
      existingEndpoint,
      waId: args.waId,
      phoneNumber: args.phoneNumber,
      profileName: args.profileName,
      occurredAt: args.occurredAt,
    });
  }

  if (!existingEndpoint) {
    throw new ConvexError("No active WhatsApp lane was found for this sender.");
  }

  let conversation =
    existingEndpoint.activeConversationId
      ? await ctx.db.get(existingEndpoint.activeConversationId)
      : null;

  if (!conversation) {
    const fallbackConversations = await ctx.db
      .query("conversations")
      .withIndex("by_messaging_endpoint", (q) =>
        q.eq("messagingEndpointId", existingEndpoint._id),
      )
      .collect();
    conversation =
      fallbackConversations.sort(
        (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0),
      )[0] ?? null;
  }

  if (!conversation) {
    throw new ConvexError("This WhatsApp endpoint is not linked to a job lane.");
  }

  const now = Date.now();
  const serviceWindowClosesAt = getWhatsAppServiceWindowClosesAt(args.occurredAt);

  await Promise.all([
    ctx.db.patch(existingEndpoint._id, {
      displayName: args.profileName ?? existingEndpoint.displayName,
      lastInboundAt: args.occurredAt,
      serviceWindowClosesAt,
      activeConversationId: conversation._id,
      status: "active",
      updatedAt: now,
    }),
    ensureExternalEndpointParticipant(ctx, {
      conversationId: conversation._id,
      endpointId: existingEndpoint._id,
      externalDisplayName: args.profileName ?? existingEndpoint.displayName,
    }),
  ]);

  return {
    endpoint: {
      ...existingEndpoint,
      displayName: args.profileName ?? existingEndpoint.displayName,
      lastInboundAt: args.occurredAt,
      serviceWindowClosesAt,
      activeConversationId: conversation._id,
      updatedAt: now,
    },
    conversation,
  };
}

export const createLaneInviteRecord = internalMutation({
  args: {
    jobId: v.id("cleaningJobs"),
    cleanerUserId: v.id("users"),
    createdBy: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const [job, cleaner, creator] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.cleanerUserId),
      ctx.db.get(args.createdBy),
    ]);

    if (!job || !cleaner || !creator) {
      throw new ConvexError("Job, cleaner, or creator was not found.");
    }
    if (!job.assignedCleanerIds.includes(cleaner._id)) {
      throw new ConvexError("Cleaner is not assigned to this job.");
    }

    const conversation = await getOrCreateWhatsAppLane(ctx, {
      job,
      cleanerUserId: cleaner._id,
      createdBy: creator._id,
    });

    const inviteId = await ctx.db.insert("whatsappLaneInvites", {
      token: args.token,
      jobId: job._id,
      cleanerUserId: cleaner._id,
      conversationId: conversation._id,
      createdBy: creator._id,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return {
      inviteId,
      conversationId: conversation._id,
      propertyId: job.propertyId,
    };
  },
});

export const bootstrapInboundMessage = internalMutation({
  args: {
    providerMessageId: v.string(),
    waId: v.string(),
    phoneNumber: v.string(),
    profileName: v.optional(v.string()),
    body: v.string(),
    inviteToken: v.optional(v.string()),
    occurredAt: v.number(),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const idempotencyKey = `meta:message:${args.providerMessageId}`;
    const existingTransport = await ctx.db
      .query("messageTransportEvents")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .first();

    if (existingTransport) {
      return {
        alreadyProcessed: true,
        conversationId: existingTransport.conversationId ?? null,
        messageId: existingTransport.messageId ?? null,
        endpointId: existingTransport.endpointId ?? null,
      };
    }

    const { endpoint, conversation } = await resolveInboundConversation(ctx, {
      waId: args.waId,
      phoneNumber: args.phoneNumber,
      profileName: args.profileName,
      inviteToken: args.inviteToken,
      occurredAt: args.occurredAt,
    });

    const messageId = await ctx.db.insert("conversationMessages", {
      conversationId: conversation._id,
      authorKind: "external_contact",
      authorEndpointId: endpoint._id,
      messageKind: "user",
      channel: "whatsapp",
      body: args.body,
      metadata: {
        providerMessageId: args.providerMessageId,
        receivedAt: args.occurredAt,
      },
      createdAt: args.occurredAt,
    });

    await ctx.db.patch(conversation._id, {
      status: "open",
      messagingEndpointId: endpoint._id,
      lastMessageAt: args.occurredAt,
      lastMessagePreview: buildConversationPreview(args.body),
      updatedAt: Date.now(),
    });

    await upsertTransportEvent(ctx, {
      idempotencyKey,
      providerMessageId: args.providerMessageId,
      conversationId: conversation._id,
      messageId,
      endpointId: endpoint._id,
      direction: "inbound",
      currentStatus: "received",
      payload: args.payload,
      occurredAt: args.occurredAt,
    });

    const recipientIds = await listLaneRecipientIds(ctx, conversation._id);
    if (recipientIds.length > 0) {
      const property =
        conversation.propertyId !== undefined
          ? await ctx.db.get(conversation.propertyId)
          : null;
      await createNotificationsForUsers(ctx, {
        userIds: recipientIds,
        type: "message_received",
        title: property?.name
          ? `New WhatsApp message for ${property.name}`
          : "New WhatsApp message",
        message: `${args.profileName ?? args.phoneNumber}: ${buildConversationPreview(args.body)}`,
        data: {
          conversationId: conversation._id,
          jobId: conversation.linkedJobId,
          messageId,
          propertyId: conversation.propertyId,
          channel: "whatsapp",
        },
      });
    }

    return {
      alreadyProcessed: false,
      conversationId: conversation._id,
      messageId,
      endpointId: endpoint._id,
    };
  },
});

export const attachInboundMediaToMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    messageId: v.id("conversationMessages"),
    providerMediaId: v.string(),
    mimeType: v.string(),
    fileName: v.string(),
    byteSize: v.number(),
    storageId: v.id("_storage"),
    sourceUrl: v.optional(v.string()),
    caption: v.optional(v.string()),
    attachmentKind: v.union(v.literal("image"), v.literal("document")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("conversationMessageAttachments")
      .withIndex("by_provider_media_id", (q) =>
        q.eq("providerMediaId", args.providerMediaId),
      )
      .first();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("conversationMessageAttachments", {
      conversationId: args.conversationId,
      messageId: args.messageId,
      storageId: args.storageId,
      attachmentKind: args.attachmentKind,
      channel: "whatsapp",
      mimeType: args.mimeType,
      fileName: args.fileName,
      byteSize: args.byteSize,
      sourceUrl: args.sourceUrl,
      providerMediaId: args.providerMediaId,
      caption: args.caption,
      createdAt: Date.now(),
    });
  },
});

export const recordOutboundMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    authorUserId: v.id("users"),
    body: v.string(),
    providerMessageId: v.optional(v.string()),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const [conversation, author] = await Promise.all([
      ctx.db.get(args.conversationId),
      ctx.db.get(args.authorUserId),
    ]);

    if (!conversation) {
      throw new ConvexError("Conversation not found.");
    }
    if (!author) {
      throw new ConvexError("Author not found.");
    }
    if (conversation.channel !== "whatsapp") {
      throw new ConvexError("Conversation is not a WhatsApp lane.");
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("conversationMessages", {
      conversationId: conversation._id,
      authorKind: "user",
      authorUserId: author._id,
      messageKind: "user",
      channel: "whatsapp",
      body: args.body,
      metadata: {
        providerMessageId: args.providerMessageId,
      },
      createdAt: now,
    });

    await ctx.db.patch(conversation._id, {
      status: "open",
      lastMessageAt: now,
      lastMessagePreview: buildConversationPreview(args.body),
      updatedAt: now,
    });

    await ensureConversationParticipant(ctx, {
      conversationId: conversation._id,
      userId: author._id,
      markReadAt: now,
    });

    await upsertTransportEvent(ctx, {
      idempotencyKey: `meta:message:${args.providerMessageId ?? String(messageId)}`,
      providerMessageId: args.providerMessageId,
      conversationId: conversation._id,
      messageId,
      endpointId: conversation.messagingEndpointId ?? undefined,
      direction: "outbound",
      currentStatus: "sent",
      payload: args.payload,
      occurredAt: now,
    });

    return {
      messageId,
      conversationId: conversation._id,
    };
  },
});

export const recordStatusUpdate = internalMutation({
  args: {
    providerMessageId: v.string(),
    idempotencyKey: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("received"),
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("read"),
      v.literal("failed"),
    ),
    payload: v.optional(v.any()),
    occurredAt: v.number(),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await upsertTransportEvent(ctx, {
      idempotencyKey: args.idempotencyKey,
      providerMessageId: args.providerMessageId,
      direction: "outbound",
      currentStatus: args.status,
      payload: args.payload,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
      occurredAt: args.occurredAt,
    });

    return { success: true };
  },
});

export const promoteAttachmentToPhoto = mutation({
  args: {
    attachmentId: v.id("conversationMessageAttachments"),
    roomName: v.string(),
    photoType: v.union(
      v.literal("before"),
      v.literal("after"),
      v.literal("incident"),
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    requirePrivilegedUser(user);

    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment) {
      throw new ConvexError("Attachment not found.");
    }
    if (attachment.attachmentKind !== "image") {
      throw new ConvexError("Only image attachments can be promoted to job photos.");
    }
    if (!attachment.storageId) {
      throw new ConvexError("Attachment does not have stored media.");
    }

    const conversation = await ctx.db.get(attachment.conversationId);
    if (!conversation?.linkedJobId) {
      throw new ConvexError("Attachment is not linked to a job conversation.");
    }

    const canAccess = await getConversationParticipant(
      ctx,
      conversation._id,
      user._id,
    );
    if (!canAccess && !isPrivilegedRole(user.role)) {
      throw new ConvexError("You are not authorized to promote this attachment.");
    }

    const photoId = await ctx.db.insert("photos", {
      cleaningJobId: conversation.linkedJobId,
      storageId: attachment.storageId,
      roomName: args.roomName.trim(),
      type: args.photoType,
      source: "whatsapp",
      notes: args.notes?.trim() || attachment.caption,
      uploadedBy: user._id,
      uploadedAt: Date.now(),
    });

    return {
      success: true,
      photoId,
    };
  },
});
