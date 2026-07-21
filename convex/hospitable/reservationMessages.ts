export function buildReservationMessageRequest(args: {
  apiKey: string;
  baseUrl: string;
  reservationId: string;
  message: string;
}): { url: string; init: RequestInit } {
  const baseUrl = args.baseUrl.replace(/\/$/, "");
  return {
    url: `${baseUrl}/reservations/${encodeURIComponent(args.reservationId)}/messages`,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: args.message }),
    },
  };
}

export type ReservationMessageSender = "guest" | "host" | "system";

export interface ReservationMessage {
  id: string;
  senderRole: ReservationMessageSender;
  body: string;
  createdAt: number;
  platform?: string;
  attachments: string[];
}

type GenericRecord = Record<string, unknown>;

function isRecord(value: unknown): value is GenericRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? undefined : parsed;
}

function normalizeSender(value: unknown): ReservationMessageSender {
  const raw = asString(value)?.toLowerCase() ?? "";
  if (raw.includes("guest") || raw.includes("inbound")) return "guest";
  if (
    raw.includes("host") ||
    raw.includes("team") ||
    raw.includes("owner") ||
    raw.includes("outbound")
  ) {
    return "host";
  }
  return "system";
}

function normalizeAttachments(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    if (!isRecord(item)) return [];
    const url = asString(item.url) ?? asString(item.download_url) ?? asString(item.href);
    return url ? [url] : [];
  });
}

function normalizeMessage(raw: unknown, index: number): ReservationMessage | null {
  if (!isRecord(raw)) return null;
  const sender = isRecord(raw.sender) ? raw.sender : undefined;
  const attachments = normalizeAttachments(raw.attachments);
  const body =
    asString(raw.body) ??
    asString(raw.message) ??
    asString(raw.text) ??
    asString(raw.content) ??
    (attachments.length > 0 ? "[Attachment]" : undefined);
  const createdAt =
    asTimestamp(raw.created_at) ??
    asTimestamp(raw.createdAt) ??
    asTimestamp(raw.sent_at) ??
    asTimestamp(raw.timestamp);
  if (!body || createdAt === undefined) return null;

  const platform = asString(raw.platform) ?? asString(raw.channel);
  return {
    id: asString(raw.id) ?? `${createdAt}-${index}`,
    senderRole: normalizeSender(
      raw.sender_role ?? raw.senderRole ?? raw.direction ?? sender?.role ?? sender?.type,
    ),
    body,
    createdAt,
    ...(platform ? { platform } : {}),
    attachments,
  };
}

export interface ReservationMessagePage {
  messages: ReservationMessage[];
  hasMore: boolean;
}

/** Normalize Hospitable's documented paginated envelope plus older variants. */
export function normalizeReservationMessagePage(payload: unknown): ReservationMessagePage {
  if (!isRecord(payload)) return { messages: [], hasMore: false };
  const data = payload.data;
  const dataRecord = isRecord(data) ? data : undefined;
  const rawMessages = Array.isArray(data)
    ? data
    : Array.isArray(dataRecord?.messages)
      ? dataRecord.messages
      : Array.isArray(payload.messages)
        ? payload.messages
        : [];
  const messages = rawMessages
    .map(normalizeMessage)
    .filter((message): message is ReservationMessage => message !== null);

  const meta = isRecord(payload.meta) ? payload.meta : undefined;
  const links = isRecord(payload.links) ? payload.links : undefined;
  const currentPage = asNumber(meta?.current_page) ?? asNumber(meta?.currentPage);
  const lastPage = asNumber(meta?.last_page) ?? asNumber(meta?.lastPage);
  const hasMore =
    (currentPage !== undefined && lastPage !== undefined && currentPage < lastPage) ||
    Boolean(asString(links?.next));

  return { messages, hasMore };
}
