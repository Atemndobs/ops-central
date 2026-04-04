"use node";

import { v } from "convex/values";
import { internalAction, ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import webpush from "web-push";

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
  channels?: string[];
}

interface WebPushSubscriptionShape {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
}

function isRecord(value: unknown): value is GenericRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidExpoPushToken(token: string): boolean {
  return token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");
}

function isValidWebPushSubscription(value: unknown): value is WebPushSubscriptionShape {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.endpoint === "string" &&
    value.endpoint.length > 0 &&
    (value.expirationTime === null || typeof value.expirationTime === "number") &&
    isRecord(value.keys) &&
    typeof value.keys.auth === "string" &&
    value.keys.auth.length > 0 &&
    typeof value.keys.p256dh === "string" &&
    value.keys.p256dh.length > 0
  );
}

function getWebPushSubscription(user: Doc<"users">): WebPushSubscriptionShape | null {
  if (!isRecord(user.metadata)) {
    return null;
  }

  const candidate = user.metadata.webPushSubscription;
  return isValidWebPushSubscription(candidate) ? candidate : null;
}

function getVapidConfig() {
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim() || "mailto:ops@chezsoicleaning.com";
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();

  if (!publicKey || !privateKey) {
    return null;
  }

  return { subject, publicKey, privateKey };
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

function buildNotificationUrl(
  user: Doc<"users">,
  notification: Doc<"notifications">,
): string {
  const data = isRecord(notification.data) ? notification.data : {};
  const jobId = typeof data.jobId === "string" ? data.jobId : null;

  if (jobId) {
    if (user.role === "cleaner") {
      return `/cleaner/jobs/${jobId}`;
    }

    if (notification.type === "awaiting_approval" || notification.type === "rework_required") {
      return `/review?jobId=${jobId}`;
    }

    return `/jobs/${jobId}`;
  }

  if (notification.type === "low_stock") {
    return "/inventory";
  }

  if (notification.type === "incident_created") {
    return "/work-orders";
  }

  return user.role === "cleaner" ? "/cleaner" : "/settings?tab=notifications";
}

async function sendWebPushNotification(
  ctx: ActionCtx,
  user: Doc<"users">,
  notification: Doc<"notifications">,
  unreadCount: number,
): Promise<SendPushResult> {
  const subscription = getWebPushSubscription(user);
  if (!subscription) {
    return { success: false, error: "User has no web push subscription." };
  }

  const vapidConfig = getVapidConfig();
  if (!vapidConfig) {
    return { success: false, error: "Missing VAPID configuration." };
  }

  webpush.setVapidDetails(
    vapidConfig.subject,
    vapidConfig.publicKey,
    vapidConfig.privateKey,
  );

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.message,
    badge: unreadCount,
    url: buildNotificationUrl(user, notification),
    tag: `notification:${String(notification._id)}`,
    data: buildPayloadData(String(notification._id), notification.type, notification.data),
  });

  try {
    await webpush.sendNotification(subscription, payload, {
      TTL: 60,
      urgency: "high",
    });
    return { success: true, channels: ["webpush"] };
  } catch (error) {
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : null;

    if (statusCode === 404 || statusCode === 410) {
      await ctx.runMutation(internal.notifications.mutations.clearUserWebPushSubscription, {
        userId: user._id,
      });
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "Web push delivery failed.",
      details: error,
    };
  }
}

async function sendExpoPushNotification(
  user: Doc<"users">,
  notification: Doc<"notifications">,
  unreadCount: number,
): Promise<SendPushResult> {
  if (!user.pushToken) {
    return { success: false, error: "User has no Expo push token." };
  }

  if (!isValidExpoPushToken(user.pushToken)) {
    return { success: false, error: "Invalid Expo push token format." };
  }

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
    return {
      success: false,
      error: `Expo push request failed (${response.status}).`,
      details: payload,
    };
  }

  const ticket = extractExpoTicket(payload);
  if (ticket.status === "error") {
    return {
      success: false,
      error: ticket.message ?? "Expo push returned an error ticket.",
      details: ticket,
    };
  }

  return {
    success: true,
    ticket,
    channels: ["expo"],
  };
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

  if (!user) {
    await ctx.runMutation(internal.notifications.mutations.markPushDelivery, {
      notificationId: notification._id,
      sent: false,
    });
    return { success: false, error: "User not found." };
  }

  const unreadCount = await ctx.runQuery(internal.notifications.queries.getUnreadCount, {
    userId: notification.userId,
  });

  const channelResults = await Promise.all([
    sendWebPushNotification(ctx, user, notification, unreadCount),
    sendExpoPushNotification(user, notification, unreadCount),
  ]);
  const delivered = channelResults.some((result) => result.success);
  const channels = channelResults.flatMap((result) => result.channels ?? []);

  await ctx.runMutation(internal.notifications.mutations.markPushDelivery, {
    notificationId: notification._id,
    sent: delivered,
  });

  if (!delivered) {
    return {
      success: false,
      error: channelResults
        .map((result) => result.error)
        .filter((error): error is string => typeof error === "string" && error.length > 0)
        .join(" | "),
      details: channelResults,
    };
  }

  return {
    success: true,
    channels,
    details: channelResults,
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
