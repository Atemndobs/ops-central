"use node";

import { buildWhatsAppInvitePrefillText, normalizeWhatsAppPhoneNumber } from "./lib";

type MetaWhatsAppConfig = {
  accessToken: string;
  phoneNumberId: string;
  webhookVerifyToken: string;
  appSecret: string;
  businessPhone: string | null;
  graphVersion: string;
};

type MetaSendTextResult = {
  providerMessageId: string | null;
  payload: unknown;
};

type MetaMediaDownloadResult = {
  blob: Blob;
  mimeType: string;
  fileName: string;
  byteSize: number;
  sourceUrl: string;
};

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required WhatsApp configuration: ${name}`);
  }
  return value;
}

export function getMetaWebhookVerifyToken() {
  return getRequiredEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
}

export function getMetaAppSecret() {
  return getRequiredEnv("WHATSAPP_APP_SECRET");
}

export function getMetaWhatsAppConfig(): MetaWhatsAppConfig {
  const accessToken = getRequiredEnv("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = getRequiredEnv("WHATSAPP_PHONE_NUMBER_ID");
  const webhookVerifyToken = getMetaWebhookVerifyToken();
  const appSecret = getMetaAppSecret();
  const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || "v23.0";
  const businessPhone = normalizeWhatsAppPhoneNumber(
    process.env.WHATSAPP_BUSINESS_PHONE_E164,
  );

  return {
    accessToken,
    phoneNumberId,
    webhookVerifyToken,
    appSecret,
    businessPhone,
    graphVersion,
  };
}

export function buildMetaInviteUrl(args: {
  token: string;
  propertyName?: string | null;
}) {
  const config = getMetaWhatsAppConfig();
  if (!config.businessPhone) {
    throw new Error(
      "Missing WHATSAPP_BUSINESS_PHONE_E164 for WhatsApp invite deep links.",
    );
  }

  const text = buildWhatsAppInvitePrefillText(args);
  const phoneDigits = config.businessPhone.replace(/[^\d]/g, "");
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(text)}`;
}

function buildGraphUrl(path: string, graphVersion: string) {
  return `https://graph.facebook.com/${graphVersion}/${path}`;
}

function getAuthHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

function getFileNameFromMimeType(mimeType: string) {
  if (mimeType === "application/pdf") {
    return "attachment.pdf";
  }
  if (mimeType === "image/jpeg") {
    return "image.jpg";
  }
  if (mimeType === "image/png") {
    return "image.png";
  }
  if (mimeType === "image/webp") {
    return "image.webp";
  }
  if (mimeType.startsWith("text/")) {
    return "attachment.txt";
  }
  return "attachment.bin";
}

export async function sendMetaTextMessage(args: {
  to: string;
  body: string;
  replyToProviderMessageId?: string;
}) {
  const config = getMetaWhatsAppConfig();
  const response = await fetch(
    buildGraphUrl(`${config.phoneNumberId}/messages`, config.graphVersion),
    {
      method: "POST",
      headers: {
        ...getAuthHeaders(config.accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: args.to.replace(/[^\d]/g, ""),
        context: args.replyToProviderMessageId
          ? { message_id: args.replyToProviderMessageId }
          : undefined,
        type: "text",
        text: {
          preview_url: false,
          body: args.body,
        },
      }),
    },
  );

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Meta WhatsApp send failed (${response.status}): ${JSON.stringify(payload)}`,
    );
  }

  const providerMessageId = Array.isArray((payload as { messages?: unknown[] })?.messages)
    ? ((payload as { messages: Array<{ id?: unknown }> }).messages[0]?.id as
        | string
        | undefined) ?? null
    : null;

  return {
    providerMessageId,
    payload,
  } satisfies MetaSendTextResult;
}

export async function downloadMetaMedia(args: {
  mediaId: string;
  fileName?: string | null;
}) {
  const config = getMetaWhatsAppConfig();
  const metadataResponse = await fetch(
    buildGraphUrl(args.mediaId, config.graphVersion),
    {
      headers: getAuthHeaders(config.accessToken),
    },
  );
  const metadataPayload: unknown = await metadataResponse
    .json()
    .catch(() => null);

  if (!metadataResponse.ok) {
    throw new Error(
      `Meta media lookup failed (${metadataResponse.status}): ${JSON.stringify(metadataPayload)}`,
    );
  }

  const sourceUrl =
    typeof (metadataPayload as { url?: unknown })?.url === "string"
      ? ((metadataPayload as { url: string }).url)
      : null;
  const mimeType =
    typeof (metadataPayload as { mime_type?: unknown })?.mime_type === "string"
      ? ((metadataPayload as { mime_type: string }).mime_type)
      : "application/octet-stream";

  if (!sourceUrl) {
    throw new Error("Meta media lookup response did not include a download URL.");
  }

  const binaryResponse = await fetch(sourceUrl, {
    headers: getAuthHeaders(config.accessToken),
  });
  if (!binaryResponse.ok) {
    const errorText = await binaryResponse.text().catch(() => "");
    throw new Error(
      `Meta media download failed (${binaryResponse.status}): ${errorText}`,
    );
  }

  const arrayBuffer = await binaryResponse.arrayBuffer();
  const blob = new Blob([arrayBuffer], { type: mimeType });
  const fileName = args.fileName?.trim() || getFileNameFromMimeType(mimeType);

  return {
    blob,
    mimeType,
    fileName,
    byteSize: arrayBuffer.byteLength,
    sourceUrl,
  } satisfies MetaMediaDownloadResult;
}
