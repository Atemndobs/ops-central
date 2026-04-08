import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import {
  assertConversationAccess,
  canAccessJobConversation,
  getConversationParticipant,
  getJobConversationByJobId,
} from "./lib";

async function getUsersByIds(
  ctx: QueryCtx,
  userIds: Id<"users">[],
) {
  const docs = await Promise.all(userIds.map((userId) => ctx.db.get(userId)));
  return new Map(
    docs
      .filter((user): user is Doc<"users"> => Boolean(user))
      .map((user) => [user._id, user] as const),
  );
}

export const listMyConversations = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const participants = await ctx.db
      .query("conversationParticipants")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const conversationIds = [...new Set(participants.map((row) => row.conversationId))];
    const conversations = await Promise.all(
      conversationIds.map((conversationId) => ctx.db.get(conversationId)),
    );

    const activeConversations = conversations.filter(
      (conversation): conversation is Doc<"conversations"> => Boolean(conversation),
    );

    const linkedJobIds = [
      ...new Set(
        activeConversations
          .map((conversation) => conversation.linkedJobId)
          .filter((jobId): jobId is Id<"cleaningJobs"> => Boolean(jobId)),
      ),
    ];
    const jobs = await Promise.all(linkedJobIds.map((jobId) => ctx.db.get(jobId)));
    const jobById = new Map(
      jobs
        .filter((job): job is Doc<"cleaningJobs"> => Boolean(job))
        .map((job) => [job._id, job] as const),
    );

    const propertyIds = [
      ...new Set(
        activeConversations
          .map((conversation) => conversation.propertyId)
          .filter((propertyId): propertyId is Id<"properties"> => Boolean(propertyId)),
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

    const participantByConversationId = new Map(
      participants.map((participant) => [participant.conversationId, participant] as const),
    );

    return activeConversations
      .map((conversation) => {
        const job = conversation.linkedJobId
          ? jobById.get(conversation.linkedJobId) ?? null
          : null;
        const property = conversation.propertyId
          ? propertyById.get(conversation.propertyId) ?? null
          : null;
        const participant = participantByConversationId.get(conversation._id) ?? null;
        const unread =
          typeof conversation.lastMessageAt === "number" &&
          (participant?.lastReadMessageAt ?? 0) < conversation.lastMessageAt;

        return {
          ...conversation,
          unread,
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
              }
            : null,
        };
      })
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
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

    const [participants, messages, job] = await Promise.all([
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
      conversation.linkedJobId ? ctx.db.get(conversation.linkedJobId) : Promise.resolve(null),
    ]);

    const property = conversation.propertyId
      ? await ctx.db.get(conversation.propertyId)
      : null;
    const userIds = [
      ...new Set(
        [
          ...participants.map((participant) => participant.userId),
          ...messages.map((message) => message.authorUserId),
        ].filter((userId): userId is Id<"users"> => Boolean(userId)),
      ),
    ];
    const usersById = await getUsersByIds(ctx, userIds);
    const selfParticipant =
      (await getConversationParticipant(ctx, args.conversationId, user._id)) ?? null;

    return {
      ...conversation,
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
      participants: participants.map((participant) => {
        const participantUser = participant.userId
          ? usersById.get(participant.userId) ?? null
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
        };
      }),
      messages: messages
        .slice()
        .reverse()
        .map((message) => {
          const author = message.authorUserId
            ? usersById.get(message.authorUserId) ?? null
            : null;
          return {
            ...message,
            author: author
              ? {
                  _id: author._id,
                  name: author.name,
                  email: author.email,
                  role: author.role,
                }
              : null,
          };
        }),
      selfParticipant,
      unread:
        typeof conversation.lastMessageAt === "number" &&
        (selfParticipant?.lastReadMessageAt ?? 0) < conversation.lastMessageAt,
    };
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
