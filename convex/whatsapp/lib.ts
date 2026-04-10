export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const WHATSAPP_INVITE_PREFIX = "opscentral:";

export function normalizeWhatsAppPhoneNumber(value: string | undefined | null) {
  if (!value) {
    return null;
  }

  const digits = value.replace(/[^\d+]/g, "");
  if (!digits) {
    return null;
  }

  if (digits.startsWith("+")) {
    return digits.length >= 8 ? digits : null;
  }

  const normalized = `+${digits}`;
  return normalized.length >= 8 ? normalized : null;
}

export function buildWhatsAppInvitePrefillText(args: {
  token: string;
  propertyName?: string | null;
}) {
  const propertySuffix =
    args.propertyName && args.propertyName.trim().length > 0
      ? ` for ${args.propertyName.trim()}`
      : "";
  return `${WHATSAPP_INVITE_PREFIX}${args.token}${propertySuffix}`;
}

export function extractWhatsAppInviteToken(text: string | undefined | null) {
  if (!text) {
    return null;
  }

  const match = text.match(
    new RegExp(`${WHATSAPP_INVITE_PREFIX.replace(":", "\\:")}([A-Za-z0-9_-]{12,})`, "i"),
  );
  return match?.[1] ?? null;
}

export function getWhatsAppServiceWindowClosesAt(lastInboundAt: number) {
  return lastInboundAt + WHATSAPP_SERVICE_WINDOW_MS;
}

export function isWhatsAppServiceWindowOpen(
  serviceWindowClosesAt: number | undefined | null,
  now = Date.now(),
) {
  return typeof serviceWindowClosesAt === "number" && serviceWindowClosesAt > now;
}

export function getAttachmentKindFromMimeType(mimeType: string | undefined | null) {
  if (!mimeType) {
    return null;
  }

  if (mimeType.startsWith("image/")) {
    return "image" as const;
  }

  if (
    mimeType === "application/pdf" ||
    mimeType.startsWith("text/") ||
    mimeType.includes("document") ||
    mimeType.includes("officedocument")
  ) {
    return "document" as const;
  }

  return null;
}

export function buildAttachmentPlaceholder(args: {
  attachmentKind: "image" | "document";
  fileName?: string | null;
  caption?: string | null;
}) {
  const label =
    args.attachmentKind === "image"
      ? args.caption?.trim() || "[Image]"
      : args.fileName?.trim() || "[Document]";
  return label.slice(0, 200);
}
