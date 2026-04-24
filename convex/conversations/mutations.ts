import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import { createNotificationsForUsers } from "../lib/opsNotifications";
import {
  assertConversationAccess,
  buildConversationPreview,
  canAccessJobConversation,
  ensureConversationParticipant,
  getConversationLaneKind,
  getJobConversationByJobId,
  isPrivilegedRole,
  seedJobConversationParticipants,
  syncConversationStatusForJob,
} from "./lib";

export const ensureJobConversation = mutation({
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

    const now = Date.now();
    let conversation = await getJobConversationByJobId(ctx, args.jobId);
    let created = false;

    if (!conversation) {
      const conversationId = await ctx.db.insert("conversations", {
        linkedJobId: job._id,
        propertyId: job.propertyId,
        laneKind: "internal_shared",
        channel: "internal",
        kind: "job",
        status:
          job.status === "completed" || job.status === "cancelled" ? "closed" : "open",
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      });
      conversation = await ctx.db.get(conversationId);
      created = true;
    }

    if (!conversation) {
      throw new ConvexError("Unable to create conversation.");
    }

    await seedJobConversationParticipants(ctx, {
      conversationId: conversation._id,
      job,
      laneKind: "internal_shared",
    });

    if (isPrivilegedRole(user.role)) {
      await ensureConversationParticipant(ctx, {
        conversationId: conversation._id,
        userId: user._id,
      });
    }

    await syncConversationStatusForJob(ctx, {
      jobId: job._id,
      nextStatus: job.status,
    });

    return {
      conversationId: conversation._id,
      created,
    };
  },
});

export const sendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    body: v.string(),
    sourceLang: v.optional(v.union(v.literal("en"), v.literal("es"))),
    // Optional audio attachment — populated by the voice composer when the
    // `voice_audio_attachments` feature flag is ON. The storageId must come
    // from the `transcribe` action's `retainedAudio` response (the action
    // skips its own delete when retention is on, handing ownership to the
    // message this mutation creates).
    audioAttachment: v.optional(
      v.object({
        storageId: v.id("_storage"),
        mimeType: v.string(),
        byteSize: v.number(),
        durationMs: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new ConvexError("Conversation not found.");
    }
    if (
      conversation.channel !== "internal" ||
      getConversationLaneKind(conversation) !== "internal_shared"
    ) {
      throw new ConvexError(
        "Use the WhatsApp reply flow for non-internal conversations.",
      );
    }

    const body = args.body.trim();
    if (!body) {
      throw new ConvexError("Message body cannot be empty.");
    }
    if (body.length > 4000) {
      throw new ConvexError("Message body is too long.");
    }

    const linkedJob = conversation.linkedJobId
      ? await ctx.db.get(conversation.linkedJobId)
      : null;

    await assertConversationAccess(ctx, { user, conversation });
    await ensureConversationParticipant(ctx, {
      conversationId: conversation._id,
      userId: user._id,
    });

    if (linkedJob) {
      await seedJobConversationParticipants(ctx, {
        conversationId: conversation._id,
        job: linkedJob,
      });
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("conversationMessages", {
      conversationId: conversation._id,
      authorKind: "user",
      authorUserId: user._id,
      messageKind: "user",
      channel: "internal",
      body,
      sourceLang: args.sourceLang ?? "en",
      createdAt: now,
    });

    // If this is a voice message with retained audio, attach the blob as a
    // playable "audio" attachment. The storageId was handed over to us by
    // the `transcribe` action; ownership now belongs to this attachment row.
    if (args.audioAttachment) {
      const audio = args.audioAttachment;
      // Derive a filename from timestamp + extension for download UX. Opus
      // in webm is the common case; mp4/aac on Safari.
      const ext = audio.mimeType.includes("mp4")
        ? "m4a"
        : audio.mimeType.includes("ogg")
          ? "ogg"
          : "webm";
      await ctx.db.insert("conversationMessageAttachments", {
        conversationId: conversation._id,
        messageId,
        storageId: audio.storageId,
        attachmentKind: "audio",
        channel: "internal",
        mimeType: audio.mimeType,
        fileName: `voice-${now}.${ext}`,
        byteSize: audio.byteSize,
        audioDurationMs: audio.durationMs,
        createdAt: now,
      });
    }

    await ctx.db.patch(conversation._id, {
      status: "open",
      lastMessageAt: now,
      lastMessagePreview: buildConversationPreview(body),
      updatedAt: now,
    });

    await ensureConversationParticipant(ctx, {
      conversationId: conversation._id,
      userId: user._id,
      markReadAt: now,
    });

    const participants = await ctx.db
      .query("conversationParticipants")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
      .collect();

    const recipientIds = [
      ...new Set(
        participants
          .filter(
            (participant) =>
              participant.userId &&
              participant.userId !== user._id &&
              participant.mutedAt === undefined,
          )
          .map((participant) => participant.userId!),
      ),
    ];

    if (recipientIds.length > 0) {
      const property =
        conversation.propertyId || linkedJob?.propertyId
          ? await ctx.db.get((conversation.propertyId ?? linkedJob?.propertyId)!)
          : null;
      await createNotificationsForUsers(ctx, {
        userIds: recipientIds,
        type: "message_received",
        title: property?.name
          ? `New message for ${property.name}`
          : "New job message",
        message: `${user.name ?? user.email}: ${buildConversationPreview(body)}`,
        data: {
          conversationId: conversation._id,
          jobId: linkedJob?._id ?? conversation.linkedJobId,
          messageId,
          propertyId: property?._id,
        },
      });
    }

    return {
      conversationId: conversation._id,
      messageId,
      createdAt: now,
    };
  },
});

export const markConversationRead = mutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new ConvexError("Conversation not found.");
    }

    await assertConversationAccess(ctx, { user, conversation });
    const markReadAt = conversation.lastMessageAt ?? Date.now();
    await ensureConversationParticipant(ctx, {
      conversationId: args.conversationId,
      userId: user._id,
      markReadAt,
    });

    return {
      success: true,
      conversationId: args.conversationId,
      lastReadMessageAt: markReadAt,
    };
  },
});

export const closeConversation = mutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!isPrivilegedRole(user.role)) {
      throw new ConvexError("Only privileged users can close a conversation.");
    }

    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new ConvexError("Conversation not found.");
    }

    await assertConversationAccess(ctx, { user, conversation });

    await ctx.db.patch(args.conversationId, {
      status: "closed",
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});
