import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import {
  assertConversationAccess,
  canAccessJobConversation,
  getConversationLaneKind,
  getConversationParticipant,
  getJobConversationByJobId,
  getJobConversationsByJobId,
  isPrivilegedRole,
} from "./lib";
import { isWhatsAppServiceWindowOpen } from "../whatsapp/lib";

async function getUsersByIds(ctx: QueryCtx, userIds: Id<"users">[]) {
  const docs = await Promise.all(userIds.map((userId) => ctx.db.get(userId)));
  return new Map(
    docs
      .filter((user): user is Doc<"users"> => Boolean(user))
      .map((user) => [user._id, user] as const),
  );
}

async function getEndpointsByIds(
  ctx: QueryCtx,
  endpointIds: Id<"messagingEndpoints">[],
) {
  const docs = await Promise.all(
    endpointIds.map((endpointId) => ctx.db.get(endpointId)),
  );
  return new Map(
    docs
      .filter(
        (endpoint): endpoint is Doc<"messagingEndpoints"> => Boolean(endpoint),
      )
      .map((endpoint) => [endpoint._id, endpoint] as const),
  );
}

async function getMessageAttachmentMap(
  ctx: QueryCtx,
  args: {
    conversationId: Id<"conversations">;
    messageIds: Id<"conversationMessages">[];
  },
) {
  if (args.messageIds.length === 0) {
    return new Map<Id<"conversationMessages">, unknown[]>();
  }

  const recentAttachments = await ctx.db
    .query("conversationMessageAttachments")
    .withIndex("by_conversation_and_created", (q) =>
      q.eq("conversationId", args.conversationId),
    )
    .order("desc")
    .take(Math.max(20, args.messageIds.length * 4));

  const attachmentMap = new Map<Id<"conversationMessages">, unknown[]>();
  for (const attachment of recentAttachments) {
    if (!args.messageIds.includes(attachment.messageId)) {
      continue;
    }

    const url =
      attachment.storageId !== undefined
        ? await ctx.storage.getUrl(attachment.storageId)
        : null;
    const nextEntry = attachmentMap.get(attachment.messageId) ?? [];
    nextEntry.push({
      _id: attachment._id,
      attachmentKind: attachment.attachmentKind,
      mimeType: attachment.mimeType,
      fileName: attachment.fileName,
      byteSize: attachment.byteSize,
      caption: attachment.caption,
      url,
    });
    attachmentMap.set(attachment.messageId, nextEntry);
  }

  return attachmentMap;
}

async function getTransportStatusMap(
  ctx: QueryCtx,
  args: {
    conversationId: Id<"conversations">;
    messageIds: Id<"conversationMessages">[];
  },
) {
  if (args.messageIds.length === 0) {
    return new Map<
      Id<"conversationMessages">,
      { currentStatus: string; errorMessage?: string }
    >();
  }

  const events = await ctx.db
    .query("messageTransportEvents")
    .withIndex("by_conversation_and_created", (q) =>
      q.eq("conversationId", args.conversationId),
    )
    .order("desc")
    .take(Math.max(20, args.messageIds.length * 4));

  const statusMap = new Map<
    Id<"conversationMessages">,
    { currentStatus: string; errorMessage?: string }
  >();

  for (const event of events) {
    if (!event.messageId || statusMap.has(event.messageId)) {
      continue;
    }
    statusMap.set(event.messageId, {
      currentStatus: event.currentStatus,
      errorMessage: event.errorMessage,
    });
  }

  return statusMap;
}

async function buildConversationSummary(
  ctx: QueryCtx,
  args: {
    conversation: Doc<"conversations">;
    participant: Doc<"conversationParticipants"> | null;
    jobById: Map<Id<"cleaningJobs">, Doc<"cleaningJobs">>;
    propertyById: Map<Id<"properties">, Doc<"properties">>;
    userById: Map<Id<"users">, Doc<"users">>;
    endpointById: Map<Id<"messagingEndpoints">, Doc<"messagingEndpoints">>;
  },
) {
  const laneKind = getConversationLaneKind(args.conversation);
  const endpoint =
    args.conversation.messagingEndpointId !== undefined
      ? args.endpointById.get(args.conversation.messagingEndpointId) ?? null
      : null;
  const linkedCleaner =
    args.conversation.linkedCleanerId !== undefined
      ? args.userById.get(args.conversation.linkedCleanerId) ?? null
      : endpoint
      ? args.userById.get(endpoint.userId) ?? null
      : null;
  const job = args.conversation.linkedJobId
    ? args.jobById.get(args.conversation.linkedJobId) ?? null
    : null;
  const property = args.conversation.propertyId
    ? args.propertyById.get(args.conversation.propertyId) ?? null
    : null;

  return {
    ...args.conversation,
    laneKind,
    unread:
      typeof args.conversation.lastMessageAt === "number" &&
      (args.participant?.lastReadMessageAt ?? 0) < args.conversation.lastMessageAt,
    linkedJob: job
      ? {
          _id: job._id,
          status: job.status,
          scheduledStartAt: job.scheduledStartAt,
        }
      : null,
    property: property
      ? {
          _id: property._id,
          name: property.name,
          address: property.address,
          imageUrl: property.imageUrl,
        }
      : null,
    linkedCleaner: linkedCleaner
      ? {
          _id: linkedCleaner._id,
          name: linkedCleaner.name,
          email: linkedCleaner.email,
          phone: linkedCleaner.phone,
        }
      : null,
    messagingEndpoint: endpoint
      ? {
          _id: endpoint._id,
          waId: endpoint.waId,
          phoneNumber: endpoint.phoneNumber,
          displayName: endpoint.displayName,
          serviceWindowClosesAt: endpoint.serviceWindowClosesAt,
          isServiceWindowOpen: isWhatsAppServiceWindowOpen(
            endpoint.serviceWindowClosesAt,
          ),
        }
      : null,
  };
}

export const listMyConversations = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const privileged = isPrivilegedRole(user.role);

    const participants = await ctx.db
      .query("conversationParticipants")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const participantConversationIds = new Set(
      participants.map((participant) => participant.conversationId),
    );

    let activeConversations: Doc<"conversations">[];
    if (privileged) {
      const allOpenConversations = await ctx.db
        .query("conversations")
        .withIndex("by_status_last_message", (q) => q.eq("status", "open"))
        .order("desc")
        .collect();
      const closedParticipantConversations = await Promise.all(
        [...participantConversationIds].map((conversationId) =>
          ctx.db.get(conversationId),
        ),
      );

      activeConversations = [
        ...allOpenConversations,
        ...closedParticipantConversations.filter(
          (conversation): conversation is Doc<"conversations"> =>
            conversation !== null &&
            conversation.status === "closed" &&
            !allOpenConversations.some(
              (openConversation) => openConversation._id === conversation._id,
            ),
        ),
      ];
    } else {
      const conversations = await Promise.all(
        [...participantConversationIds].map((conversationId) =>
          ctx.db.get(conversationId),
        ),
      );
      activeConversations = conversations.filter(
        (conversation): conversation is Doc<"conversations"> => Boolean(conversation),
      );
    }

    const jobIds = [
      ...new Set(
        activeConversations
          .map((conversation) => conversation.linkedJobId)
          .filter((jobId): jobId is Id<"cleaningJobs"> => Boolean(jobId)),
      ),
    ];
    const jobs = await Promise.all(jobIds.map((jobId) => ctx.db.get(jobId)));
    const jobById = new Map(
      jobs
        .filter((job): job is Doc<"cleaningJobs"> => Boolean(job))
        .map((job) => [job._id, job] as const),
    );

    const propertyIds = [
      ...new Set(
        activeConversations
          .map((conversation) => conversation.propertyId)
          .filter(
            (propertyId): propertyId is Id<"properties"> => Boolean(propertyId),
          ),
      ),
    ];
    const properties = await Promise.all(
      propertyIds.map((propertyId) => ctx.db.get(propertyId)),
    );
    const propertyById = new Map(
      properties
        .filter((property): property is Doc<"properties"> => Boolean(property))
        .map((property) => [property._id, property] as const),
    );

    const userIds = [
      ...new Set(
        activeConversations
          .map((conversation) => conversation.linkedCleanerId)
          .filter((userId): userId is Id<"users"> => Boolean(userId)),
      ),
    ];
    const userById = await getUsersByIds(ctx, userIds);

    const endpointIds = [
      ...new Set(
        activeConversations
          .map((conversation) => conversation.messagingEndpointId)
          .filter(
            (endpointId): endpointId is Id<"messagingEndpoints"> =>
              Boolean(endpointId),
          ),
      ),
    ];
    const endpointById = await getEndpointsByIds(ctx, endpointIds);

    const participantByConversationId = new Map(
      participants.map((participant) => [participant.conversationId, participant] as const),
    );

    return await Promise.all(
      activeConversations
        .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
        .map((conversation) =>
          buildConversationSummary(ctx, {
            conversation,
            participant: participantByConversationId.get(conversation._id) ?? null,
            jobById,
            propertyById,
            userById,
            endpointById,
          }),
        ),
    );
  },
});

export const getConversationById = query({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      return null;
    }

    await assertConversationAccess(ctx, { user, conversation });

    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(200, Math.floor(args.limit)))
        : 100;

    const [participants, messages, job, property] = await Promise.all([
      ctx.db
        .query("conversationParticipants")
        .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
        .collect(),
      ctx.db
        .query("conversationMessages")
        .withIndex("by_conversation_and_created", (q) =>
          q.eq("conversationId", args.conversationId),
        )
        .order("desc")
        .take(limit),
      conversation.linkedJobId ? ctx.db.get(conversation.linkedJobId) : null,
      conversation.propertyId ? ctx.db.get(conversation.propertyId) : null,
    ]);

    const userIds = [
      ...new Set(
        [
          ...participants.map((participant) => participant.userId),
          ...messages.map((message) => message.authorUserId),
          conversation.linkedCleanerId,
        ].filter((userId): userId is Id<"users"> => Boolean(userId)),
      ),
    ];
    const usersById = await getUsersByIds(ctx, userIds);

    const endpointIds = [
      ...new Set(
        [
          conversation.messagingEndpointId,
          ...participants.map((participant) => participant.messagingEndpointId),
          ...messages.map((message) => message.authorEndpointId),
        ].filter(
          (endpointId): endpointId is Id<"messagingEndpoints"> => Boolean(endpointId),
        ),
      ),
    ];
    const endpointById = await getEndpointsByIds(ctx, endpointIds);

    const messageIds = messages.map((message) => message._id);
    const attachmentMap = await getMessageAttachmentMap(ctx, {
      conversationId: conversation._id,
      messageIds,
    });
    const statusMap = await getTransportStatusMap(ctx, {
      conversationId: conversation._id,
      messageIds,
    });

    const selfParticipant =
      (await getConversationParticipant(ctx, args.conversationId, user._id)) ?? null;
    const laneKind = getConversationLaneKind(conversation);
    const endpoint =
      conversation.messagingEndpointId !== undefined
        ? endpointById.get(conversation.messagingEndpointId) ?? null
        : null;
    const linkedCleaner =
      conversation.linkedCleanerId !== undefined
        ? usersById.get(conversation.linkedCleanerId) ?? null
        : endpoint
        ? usersById.get(endpoint.userId) ?? null
        : null;

    return {
      ...conversation,
      laneKind,
      linkedJob: job
        ? {
            _id: job._id,
            status: job.status,
            scheduledStartAt: job.scheduledStartAt,
            scheduledEndAt: job.scheduledEndAt,
          }
        : null,
      property: property
        ? {
            _id: property._id,
            name: property.name,
            address: property.address,
          }
        : null,
      linkedCleaner: linkedCleaner
        ? {
            _id: linkedCleaner._id,
            name: linkedCleaner.name,
            email: linkedCleaner.email,
            phone: linkedCleaner.phone,
          }
        : null,
      messagingEndpoint: endpoint
        ? {
            _id: endpoint._id,
            waId: endpoint.waId,
            phoneNumber: endpoint.phoneNumber,
            displayName: endpoint.displayName,
            serviceWindowClosesAt: endpoint.serviceWindowClosesAt,
            isServiceWindowOpen: isWhatsAppServiceWindowOpen(
              endpoint.serviceWindowClosesAt,
            ),
          }
        : null,
      participants: participants.map((participant) => {
        const participantUser = participant.userId
          ? usersById.get(participant.userId) ?? null
          : null;
        const participantEndpoint =
          participant.messagingEndpointId !== undefined
            ? endpointById.get(participant.messagingEndpointId) ?? null
            : null;

        return {
          ...participant,
          user: participantUser
            ? {
                _id: participantUser._id,
                name: participantUser.name,
                email: participantUser.email,
                role: participantUser.role,
              }
            : null,
          endpoint: participantEndpoint
            ? {
                _id: participantEndpoint._id,
                waId: participantEndpoint.waId,
                phoneNumber: participantEndpoint.phoneNumber,
                displayName: participantEndpoint.displayName,
              }
            : null,
        };
      }),
      messages: messages
        .slice()
        .reverse()
        .map((message) => {
          const author = message.authorUserId
            ? usersById.get(message.authorUserId) ?? null
            : null;
          const authorEndpoint =
            message.authorEndpointId !== undefined
              ? endpointById.get(message.authorEndpointId) ?? null
              : null;

          return {
            ...message,
            transportStatus: statusMap.get(message._id) ?? null,
            attachments: attachmentMap.get(message._id) ?? [],
            author: author
              ? {
                  _id: author._id,
                  name: author.name,
                  email: author.email,
                  role: author.role,
                }
              : null,
            authorEndpoint: authorEndpoint
              ? {
                  _id: authorEndpoint._id,
                  waId: authorEndpoint.waId,
                  phoneNumber: authorEndpoint.phoneNumber,
                  displayName: authorEndpoint.displayName,
                }
              : null,
          };
        }),
      selfParticipant,
      unread:
        typeof conversation.lastMessageAt === "number" &&
        (selfParticipant?.lastReadMessageAt ?? 0) < conversation.lastMessageAt,
      canReplyInApp:
        laneKind === "internal_shared"
          ? true
          : isWhatsAppServiceWindowOpen(endpoint?.serviceWindowClosesAt),
    };
  },
});

export const getUnreadConversationCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const privileged = isPrivilegedRole(user.role);

    const participants = await ctx.db
      .query("conversationParticipants")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const readAtByConversationId = new Map(
      participants.map((participant) => [
        participant.conversationId,
        participant.lastReadMessageAt ?? 0,
      ]),
    );

    let count = 0;
    if (privileged) {
      const allOpenConversations = await ctx.db
        .query("conversations")
        .withIndex("by_status_last_message", (q) => q.eq("status", "open"))
        .collect();

      for (const conversation of allOpenConversations) {
        if (
          typeof conversation.lastMessageAt === "number" &&
          (readAtByConversationId.get(conversation._id) ?? 0) <
            conversation.lastMessageAt
        ) {
          count += 1;
        }
      }
      return count;
    }

    for (const participant of participants) {
      const conversation = await ctx.db.get(participant.conversationId);
      if (
        conversation &&
        typeof conversation.lastMessageAt === "number" &&
        (participant.lastReadMessageAt ?? 0) < conversation.lastMessageAt
      ) {
        count += 1;
      }
    }

    return count;
  },
});

export const getConversationForJob = query({
  args: {
    jobId: v.id("cleaningJobs"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found.");
    }

    const canAccess = await canAccessJobConversation(ctx, { user, job });
    if (!canAccess) {
      throw new ConvexError("You are not authorized to access this job.");
    }

    const conversation = await getJobConversationByJobId(ctx, args.jobId);
    if (!conversation) {
      return null;
    }

    const participant = await getConversationParticipant(
      ctx,
      conversation._id,
      user._id,
    );
    const property = conversation.propertyId
      ? await ctx.db.get(conversation.propertyId)
      : null;

    return {
      ...conversation,
      laneKind: getConversationLaneKind(conversation),
      participant,
      unread:
        typeof conversation.lastMessageAt === "number" &&
        (participant?.lastReadMessageAt ?? 0) < conversation.lastMessageAt,
      linkedJob: {
        _id: job._id,
        status: job.status,
        scheduledStartAt: job.scheduledStartAt,
      },
      property: property
        ? {
            _id: property._id,
            name: property.name,
            address: property.address,
          }
        : null,
    };
  },
});

export const getConversationLanesForJob = query({
  args: {
    jobId: v.id("cleaningJobs"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!isPrivilegedRole(user.role)) {
      throw new ConvexError("Only privileged users can view WhatsApp job lanes.");
    }

    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found.");
    }

    const property = await ctx.db.get(job.propertyId);
    const conversations = await getJobConversationsByJobId(ctx, args.jobId);
    const internalConversation =
      conversations.find(
        (conversation) =>
          getConversationLaneKind(conversation) === "internal_shared" &&
          conversation.channel === "internal",
      ) ?? null;

    const whatsappConversations = conversations.filter(
      (conversation) => getConversationLaneKind(conversation) === "whatsapp_cleaner",
    );
    const whatsappConversationByCleanerId = new Map(
      whatsappConversations
        .filter(
          (conversation): conversation is Doc<"conversations"> & {
            linkedCleanerId: Id<"users">;
          } => conversation.linkedCleanerId !== undefined,
        )
        .map((conversation) => [conversation.linkedCleanerId, conversation] as const),
    );

    const cleaners = await Promise.all(
      job.assignedCleanerIds.map((cleanerId) => ctx.db.get(cleanerId)),
    );
    const cleanerDocs = cleaners.filter(
      (cleaner): cleaner is Doc<"users"> => cleaner !== null,
    );

    const endpointIds = [
      ...new Set(
        whatsappConversations
          .map((conversation) => conversation.messagingEndpointId)
          .filter(
            (endpointId): endpointId is Id<"messagingEndpoints"> =>
              Boolean(endpointId),
          ),
      ),
    ];
    const endpointById = await getEndpointsByIds(ctx, endpointIds);

    const internalParticipant =
      internalConversation !== null
        ? await getConversationParticipant(ctx, internalConversation._id, user._id)
        : null;

    const lanes = await Promise.all(
      cleanerDocs.map(async (cleaner) => {
        const conversation = whatsappConversationByCleanerId.get(cleaner._id) ?? null;
        const endpoint =
          conversation?.messagingEndpointId !== undefined
            ? endpointById.get(conversation.messagingEndpointId) ?? null
            : null;
        const participant =
          conversation !== null
            ? await getConversationParticipant(ctx, conversation._id, user._id)
            : null;

        return {
          cleaner: {
            _id: cleaner._id,
            name: cleaner.name,
            email: cleaner.email,
            phone: cleaner.phone,
          },
          conversationId: conversation?._id ?? null,
          status: conversation?.status ?? "open",
          lastMessageAt: conversation?.lastMessageAt ?? null,
          lastMessagePreview: conversation?.lastMessagePreview ?? null,
          unread:
            conversation !== null &&
            typeof conversation.lastMessageAt === "number" &&
            (participant?.lastReadMessageAt ?? 0) < conversation.lastMessageAt,
          messagingEndpoint: endpoint
            ? {
                _id: endpoint._id,
                waId: endpoint.waId,
                phoneNumber: endpoint.phoneNumber,
                displayName: endpoint.displayName,
                serviceWindowClosesAt: endpoint.serviceWindowClosesAt,
                isServiceWindowOpen: isWhatsAppServiceWindowOpen(
                  endpoint.serviceWindowClosesAt,
                ),
              }
            : null,
        };
      }),
    );

    return {
      property: property
        ? {
            _id: property._id,
            name: property.name,
            address: property.address,
          }
        : null,
      internalConversation: internalConversation
        ? {
            _id: internalConversation._id,
            lastMessageAt: internalConversation.lastMessageAt,
            lastMessagePreview: internalConversation.lastMessagePreview,
            unread:
              typeof internalConversation.lastMessageAt === "number" &&
              (internalParticipant?.lastReadMessageAt ?? 0) <
                internalConversation.lastMessageAt,
          }
        : null,
      whatsappLanes: lanes.sort((a, b) => {
        const nameA = a.cleaner.name ?? a.cleaner.email ?? "";
        const nameB = b.cleaner.name ?? b.cleaner.email ?? "";
        return nameA.localeCompare(nameB);
      }),
    };
  },
});
