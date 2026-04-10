import { ConvexError, v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { assertConversationAccess } from "../conversations/lib";

export const getOutboundContext = internalQuery({
  args: {
    conversationId: v.id("conversations"),
    requestingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const [conversation, user] = await Promise.all([
      ctx.db.get(args.conversationId),
      ctx.db.get(args.requestingUserId),
    ]);

    if (!conversation) {
      throw new ConvexError("Conversation not found.");
    }
    if (!user) {
      throw new ConvexError("User not found.");
    }

    await assertConversationAccess(ctx, { user, conversation });

    if (conversation.channel !== "whatsapp" || !conversation.messagingEndpointId) {
      throw new ConvexError("Conversation is not a WhatsApp lane.");
    }

    const endpoint = await ctx.db.get(conversation.messagingEndpointId);
    if (!endpoint) {
      throw new ConvexError("Messaging endpoint not found.");
    }

    const recentTransportEvents = await ctx.db
      .query("messageTransportEvents")
      .withIndex("by_conversation_and_created", (q) =>
        q.eq("conversationId", conversation._id),
      )
      .order("desc")
      .take(25);

    const latestProviderMessageId =
      recentTransportEvents.find((event) => typeof event.providerMessageId === "string")
        ?.providerMessageId ?? null;

    return {
      conversation,
      endpoint,
      latestProviderMessageId,
    };
  },
});
