"use node";

import { ConvexError, v } from "convex/values";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import {
  buildAttachmentPlaceholder,
  extractWhatsAppInviteToken,
  getAttachmentKindFromMimeType,
  isWhatsAppServiceWindowOpen,
  normalizeWhatsAppPhoneNumber,
} from "./lib";
import {
  getMetaAppSecret,
  buildMetaInviteUrl,
  downloadMetaMedia,
  getMetaWebhookVerifyToken,
  sendMetaTextMessage,
} from "./provider";

type MetaWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<Record<string, unknown>>;
        statuses?: Array<Record<string, unknown>>;
      };
    }>;
  }>;
};

function readWebhookTimestamp(value: unknown) {
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return asNumber * 1000;
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return Date.now();
}

function getMessageText(message: Record<string, unknown>) {
  const type = typeof message.type === "string" ? message.type : null;
  if (type === "text") {
    const body = (message.text as { body?: unknown } | undefined)?.body;
    return typeof body === "string" ? body : "";
  }

  if (type === "image") {
    const image = message.image as
      | { caption?: unknown; mime_type?: unknown; id?: unknown }
      | undefined;
    return buildAttachmentPlaceholder({
      attachmentKind: "image",
      caption: typeof image?.caption === "string" ? image.caption : null,
    });
  }

  if (type === "document") {
    const document = message.document as
      | { filename?: unknown; caption?: unknown; mime_type?: unknown; id?: unknown }
      | undefined;
    return buildAttachmentPlaceholder({
      attachmentKind: "document",
      fileName:
        typeof document?.filename === "string" ? document.filename : null,
      caption:
        typeof document?.caption === "string" ? document.caption : null,
    });
  }

  return `[Unsupported ${type ?? "message"}]`;
}

function getMediaDescriptors(message: Record<string, unknown>) {
  const type = typeof message.type === "string" ? message.type : null;
  if (type === "image") {
    const payload = message.image as
      | { id?: unknown; mime_type?: unknown; caption?: unknown }
      | undefined;
    const mediaId = typeof payload?.id === "string" ? payload.id : null;
    const mimeType =
      typeof payload?.mime_type === "string" ? payload.mime_type : "image/jpeg";
    const attachmentKind = getAttachmentKindFromMimeType(mimeType);

    if (!mediaId || !attachmentKind) {
      return [];
    }

    return [
      {
        mediaId,
        mimeType,
        fileName: null,
        caption:
          typeof payload?.caption === "string" ? payload.caption : undefined,
        attachmentKind,
      },
    ];
  }

  if (type === "document") {
    const payload = message.document as
      | {
          id?: unknown;
          mime_type?: unknown;
          caption?: unknown;
          filename?: unknown;
        }
      | undefined;
    const mediaId = typeof payload?.id === "string" ? payload.id : null;
    const mimeType =
      typeof payload?.mime_type === "string"
        ? payload.mime_type
        : "application/octet-stream";
    const attachmentKind = getAttachmentKindFromMimeType(mimeType);

    if (!mediaId || !attachmentKind) {
      return [];
    }

    return [
      {
        mediaId,
        mimeType,
        fileName:
          typeof payload?.filename === "string" ? payload.filename : null,
        caption:
          typeof payload?.caption === "string" ? payload.caption : undefined,
        attachmentKind,
      },
    ];
  }

  return [];
}

function mapStatus(status: string | undefined) {
  if (
    status === "queued" ||
    status === "received" ||
    status === "sent" ||
    status === "delivered" ||
    status === "read" ||
    status === "failed"
  ) {
    return status;
  }
  return "sent";
}

function shouldRetryWhatsAppSendWithoutContext(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("replied message not found") ||
    message.includes("context") ||
    message.includes("message_id") ||
    message.includes("131047") ||
    message.includes("131009")
  );
}

async function getAuthenticatedUser(ctx: ActionCtx) {
  const identity = await requireAuth(ctx);
  const user = await ctx.runQuery(api.users.queries.getByClerkId, {
    clerkId: identity.subject,
  });

  if (!user) {
    throw new ConvexError("User not found.");
  }

  return user;
}

export const createLaneInvite = action({
  args: {
    jobId: v.id("cleaningJobs"),
    cleanerUserId: v.id("users"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    inviteId: Id<"whatsappLaneInvites">;
    conversationId: Id<"conversations">;
    propertyId: Id<"properties">;
    token: string;
    expiresAt: number;
    inviteUrl: string;
  }> => {
    const user = await getAuthenticatedUser(ctx);
    if (
      user.role !== "admin" &&
      user.role !== "manager" &&
      user.role !== "property_ops"
    ) {
      throw new ConvexError("Only privileged users can create WhatsApp invites.");
    }

    const token = crypto.randomUUID().replace(/-/g, "");
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

    const result: {
      inviteId: Id<"whatsappLaneInvites">;
      conversationId: Id<"conversations">;
      propertyId: Id<"properties">;
    } = await ctx.runMutation(
      internal.whatsapp.mutations.createLaneInviteRecord,
      {
      ...args,
      createdBy: user._id,
      token,
      expiresAt,
      },
    );

    return {
      ...result,
      token,
      expiresAt,
      inviteUrl: buildMetaInviteUrl({ token }),
    };
  },
});

export const getWebhookVerifyToken = internalAction({
  args: {},
  handler: async () => {
    return getMetaWebhookVerifyToken();
  },
});

export const getWebhookAppSecret = internalAction({
  args: {},
  handler: async () => {
    return getMetaAppSecret();
  },
});

export const sendReply = action({
  args: {
    conversationId: v.id("conversations"),
    body: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    messageId: Id<"conversationMessages">;
    conversationId: Id<"conversations">;
  }> => {
    const user = await getAuthenticatedUser(ctx);
    const body = args.body.trim();

    if (!body) {
      throw new ConvexError("Message body cannot be empty.");
    }
    if (body.length > 4000) {
      throw new ConvexError("Message body is too long.");
    }

    const outboundContext = await ctx.runQuery(
      internal.whatsapp.queries.getOutboundContext,
      {
        conversationId: args.conversationId,
        requestingUserId: user._id,
      },
    );

    if (!isWhatsAppServiceWindowOpen(outboundContext.endpoint.serviceWindowClosesAt)) {
      throw new ConvexError(
        "The WhatsApp reply window is closed. Wait for a cleaner reply before sending again.",
      );
    }

    let sendResult: Awaited<ReturnType<typeof sendMetaTextMessage>>;
    try {
      sendResult = await sendMetaTextMessage({
        to: outboundContext.endpoint.waId,
        body,
        replyToProviderMessageId: outboundContext.latestProviderMessageId ?? undefined,
      });
    } catch (error) {
      if (
        outboundContext.latestProviderMessageId &&
        shouldRetryWhatsAppSendWithoutContext(error)
      ) {
        console.warn(
          "[whatsapp/sendReply] Reply context rejected by Meta; retrying send without context.",
          {
            conversationId: args.conversationId,
            replyToProviderMessageId: outboundContext.latestProviderMessageId,
          },
        );
        sendResult = await sendMetaTextMessage({
          to: outboundContext.endpoint.waId,
          body,
        });
      } else {
        throw error;
      }
    }

    const result: {
      messageId: Id<"conversationMessages">;
      conversationId: Id<"conversations">;
    } = await ctx.runMutation(internal.whatsapp.mutations.recordOutboundMessage, {
      conversationId: args.conversationId,
      authorUserId: user._id,
      body,
      providerMessageId: sendResult.providerMessageId ?? undefined,
      payload: sendResult.payload,
    });

    return result;
  },
});

export const processWebhookPayload = internalAction({
  args: {
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const payload = (args.payload ?? {}) as MetaWebhookPayload;
    let processedMessages = 0;
    let processedStatuses = 0;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        const contactsByWaId = new Map<string, string>();
        for (const contact of value.contacts ?? []) {
          if (typeof contact.wa_id === "string") {
            contactsByWaId.set(contact.wa_id, contact.profile?.name ?? contact.wa_id);
          }
        }

        for (const message of value.messages ?? []) {
          const providerMessageId =
            typeof message.id === "string" ? message.id : null;
          const fromWaId = typeof message.from === "string" ? message.from : null;

          if (!providerMessageId || !fromWaId) {
            continue;
          }

          const phoneNumber = normalizeWhatsAppPhoneNumber(fromWaId);
          if (!phoneNumber) {
            continue;
          }

          const body = getMessageText(message);
          const inviteToken = extractWhatsAppInviteToken(body) ?? undefined;
          const occurredAt = readWebhookTimestamp(message.timestamp);
          const profileName = contactsByWaId.get(fromWaId);

          try {
            const bootstrapResult = await ctx.runMutation(
              internal.whatsapp.mutations.bootstrapInboundMessage,
              {
                providerMessageId,
                waId: fromWaId,
                phoneNumber,
                profileName,
                body,
                inviteToken,
                occurredAt,
                payload: message,
              },
            );

            if (!bootstrapResult.alreadyProcessed) {
              if (!bootstrapResult.conversationId || !bootstrapResult.messageId) {
                throw new Error("Inbound bootstrap did not return message linkage.");
              }
              for (const media of getMediaDescriptors(message)) {
                const downloaded = await downloadMetaMedia({
                  mediaId: media.mediaId,
                  fileName: media.fileName,
                });
                const storageId = await ctx.storage.store(downloaded.blob);
                await ctx.runMutation(
                  internal.whatsapp.mutations.attachInboundMediaToMessage,
                  {
                    conversationId: bootstrapResult.conversationId,
                    messageId: bootstrapResult.messageId,
                    providerMediaId: media.mediaId,
                    mimeType: downloaded.mimeType,
                    fileName: downloaded.fileName,
                    byteSize: downloaded.byteSize,
                    storageId,
                    sourceUrl: downloaded.sourceUrl,
                    caption: media.caption,
                    attachmentKind: media.attachmentKind,
                  },
                );
              }
            }

            processedMessages += 1;
          } catch (error) {
            console.warn("[whatsapp/processWebhookPayload] Failed to process inbound message", {
              providerMessageId,
              error,
            });
          }
        }

        for (const statusPayload of value.statuses ?? []) {
          const providerMessageId =
            typeof statusPayload.id === "string" ? statusPayload.id : null;
          if (!providerMessageId) {
            continue;
          }

          const mappedStatus = mapStatus(
            typeof statusPayload.status === "string"
              ? statusPayload.status
              : undefined,
          );
          const errorData = Array.isArray(statusPayload.errors)
            ? (statusPayload.errors[0] as
                | { code?: unknown; title?: unknown; message?: unknown }
                | undefined)
            : undefined;

          await ctx.runMutation(internal.whatsapp.mutations.recordStatusUpdate, {
            providerMessageId,
            idempotencyKey: `meta:status:${providerMessageId}:${mappedStatus}:${String(
              statusPayload.timestamp ?? "",
            )}`,
            status: mappedStatus,
            payload: statusPayload,
            occurredAt: readWebhookTimestamp(statusPayload.timestamp),
            errorCode:
              typeof errorData?.code === "string"
                ? errorData.code
                : typeof errorData?.code === "number"
                ? String(errorData.code)
                : undefined,
            errorMessage:
              typeof errorData?.message === "string"
                ? errorData.message
                : typeof errorData?.title === "string"
                ? errorData.title
                : undefined,
          });
          processedStatuses += 1;
        }
      }
    }

    return {
      processedMessages,
      processedStatuses,
    };
  },
});
