import { v } from "convex/values";
import { internalAction, ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

const EXPO_PUSH_API = "https://exp.host/--/api/v2/push/send";

type GenericRecord = Record<string, unknown>;

interface ExpoPushTicket {
  status?: string;
  id?: string;
  message?: string;
}

interface SendPushResult {
  success: boolean;
  error?: string;
  details?: unknown;
  ticket?: ExpoPushTicket;
}

function isRecord(value: unknown): value is GenericRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidExpoPushToken(token: string): boolean {
  return token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");
}

function buildPayloadData(
  notificationId: string,
  type: string,
  data: unknown
): GenericRecord {
  const additionalData = isRecord(data) ? data : {};
  return {
    notificationId,
    type,
    ...additionalData,
  };
}

function extractExpoTicket(payload: unknown): ExpoPushTicket {
  if (!isRecord(payload)) {
    return {};
  }

  if (Array.isArray(payload.data) && isRecord(payload.data[0])) {
    return payload.data[0] as ExpoPushTicket;
  }

  if (isRecord(payload.data)) {
    return payload.data as ExpoPushTicket;
  }

  return payload as ExpoPushTicket;
}

async function executeSendPush(
  ctx: ActionCtx,
  notificationId: Id<"notifications">
): Promise<SendPushResult> {
  const notification = await ctx.runQuery(
    internal.notifications.queries.getNotificationByIdInternal,
    { id: notificationId }
  );

  if (!notification) {
    return { success: false, error: "Notification not found." };
  }

  const user = await ctx.runQuery(internal.notifications.queries.getUserById, {
    id: notification.userId,
  });

  if (!user?.pushToken) {
    await ctx.runMutation(internal.notifications.mutations.markPushDelivery, {
      notificationId: notification._id,
      sent: false,
    });
    return { success: false, error: "User has no push token." };
  }

  if (!isValidExpoPushToken(user.pushToken)) {
    await ctx.runMutation(internal.notifications.mutations.markPushDelivery, {
      notificationId: notification._id,
      sent: false,
    });
    return { success: false, error: "Invalid Expo push token format." };
  }

  const unreadCount = await ctx.runQuery(internal.notifications.queries.getUnreadCount, {
    userId: notification.userId,
  });

  const response = await fetch(EXPO_PUSH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      to: user.pushToken,
      sound: "default",
      title: notification.title,
      body: notification.message,
      data: buildPayloadData(
        String(notification._id),
        notification.type,
        notification.data
      ),
      priority: "high",
      badge: unreadCount,
      channelId: "default",
    }),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    await ctx.runMutation(internal.notifications.mutations.markPushDelivery, {
      notificationId: notification._id,
      sent: false,
    });
    return {
      success: false,
      error: `Expo push request failed (${response.status}).`,
      details: payload,
    };
  }

  const ticket = extractExpoTicket(payload);
  if (ticket.status === "error") {
    await ctx.runMutation(internal.notifications.mutations.markPushDelivery, {
      notificationId: notification._id,
      sent: false,
    });
    return {
      success: false,
      error: ticket.message ?? "Expo push returned an error ticket.",
      details: ticket,
    };
  }

  await ctx.runMutation(internal.notifications.mutations.markPushDelivery, {
    notificationId: notification._id,
    sent: true,
  });

  return {
    success: true,
    ticket,
  };
}

export const sendPushForNotificationInternal = internalAction({
  args: {
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args): Promise<SendPushResult> => {
    return await executeSendPush(ctx, args.notificationId);
  },
});
