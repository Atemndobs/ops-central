import type { Id } from "@convex/_generated/dataModel";

export type ConversationItem = {
  _id: Id<"conversations">;
  laneKind: "internal_shared" | "whatsapp_cleaner";
  channel: "internal" | "sms" | "whatsapp" | "email";
  unread: boolean;
  lastMessageAt?: number;
  lastMessagePreview?: string;
  linkedJob: { _id: Id<"cleaningJobs">; status: string; scheduledStartAt?: number } | null;
  property: {
    _id: Id<"properties">;
    name: string;
    address?: string;
    imageUrl?: string;
  } | null;
  linkedCleaner: {
    _id: Id<"users">;
    name?: string | null;
    email: string;
    phone?: string | null;
  } | null;
  messagingEndpoint: {
    _id: Id<"messagingEndpoints">;
    phoneNumber: string;
    displayName?: string | null;
    serviceWindowClosesAt?: number;
    isServiceWindowOpen: boolean;
  } | null;
};

export type PropertyGroup = {
  propertyId: string;
  propertyName: string;
  propertyAddress?: string;
  propertyImageUrl?: string;
  conversations: ConversationItem[];
  currentConversations: ConversationItem[];
  olderConversations: ConversationItem[];
  unreadCount: number;
  latestMessageAt?: number;
  latestMessagePreview?: string;
  hasWhatsApp: boolean;
};

export function formatListTime(timestamp?: number): string {
  if (!timestamp) return "";
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  const date = new Date(timestamp);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const yesterday = startOfToday.getTime() - 86_400_000;
  if (timestamp >= yesterday) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function isCurrentOrUpcoming(
  conversation: ConversationItem,
  startOfTodayMs: number,
): boolean {
  if (conversation.unread) return true;
  if (conversation.laneKind === "whatsapp_cleaner") return true;
  const scheduledAt = conversation.linkedJob?.scheduledStartAt;
  if (scheduledAt === undefined) return true;
  return scheduledAt >= startOfTodayMs;
}

export function groupByProperty(conversations: ConversationItem[]): PropertyGroup[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();

  const map = new Map<string, PropertyGroup>();

  for (const conv of conversations) {
    const propId = conv.property?._id ?? "unknown";
    const propName = conv.property?.name ?? "Unknown Property";
    const propAddress = conv.property?.address;
    const propImageUrl = conv.property?.imageUrl;

    if (!map.has(propId)) {
      map.set(propId, {
        propertyId: propId,
        propertyName: propName,
        propertyAddress: propAddress,
        propertyImageUrl: propImageUrl,
        conversations: [],
        currentConversations: [],
        olderConversations: [],
        unreadCount: 0,
        latestMessageAt: undefined,
        latestMessagePreview: undefined,
        hasWhatsApp: false,
      });
    }

    const group = map.get(propId)!;
    group.conversations.push(conv);
    if (isCurrentOrUpcoming(conv, startOfTodayMs)) {
      group.currentConversations.push(conv);
    } else {
      group.olderConversations.push(conv);
    }
    if (conv.unread) group.unreadCount++;
    if (conv.laneKind === "whatsapp_cleaner") group.hasWhatsApp = true;
    if (
      (conv.lastMessageAt ?? 0) > (group.latestMessageAt ?? 0) ||
      (!group.latestMessageAt && conv.lastMessageAt)
    ) {
      group.latestMessageAt = conv.lastMessageAt;
      group.latestMessagePreview = conv.lastMessagePreview;
    }
  }

  const sortByScheduledThenLastMessage = (a: ConversationItem, b: ConversationItem) => {
    const aSched = a.linkedJob?.scheduledStartAt ?? 0;
    const bSched = b.linkedJob?.scheduledStartAt ?? 0;
    if (aSched !== bSched) return aSched - bSched;
    return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
  };
  const sortByScheduledDesc = (a: ConversationItem, b: ConversationItem) => {
    const aSched = a.linkedJob?.scheduledStartAt ?? 0;
    const bSched = b.linkedJob?.scheduledStartAt ?? 0;
    return bSched - aSched;
  };

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      currentConversations: [...group.currentConversations].sort(sortByScheduledThenLastMessage),
      olderConversations: [...group.olderConversations].sort(sortByScheduledDesc),
    }))
    .sort((a, b) => {
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
      if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
      const aLatest = Math.max(...a.conversations.map((c) => c.lastMessageAt ?? 0));
      const bLatest = Math.max(...b.conversations.map((c) => c.lastMessageAt ?? 0));
      return bLatest - aLatest;
    });
}

/**
 * Deterministic colored tile for a property when no hero photo exists.
 * Maps propertyId → one of six soft-purple / warm pastel backgrounds.
 */
export function propertyTileColor(propertyId: string): { bg: string; fg: string } {
  const palette: Array<{ bg: string; fg: string }> = [
    { bg: "#F3E8FF", fg: "#5D289C" },
    { bg: "#EEDCFF", fg: "#7341B3" },
    { bg: "#E0F2FE", fg: "#075985" },
    { bg: "#DCFCE7", fg: "#166534" },
    { bg: "#FEF3C7", fg: "#92400E" },
    { bg: "#FFE4E6", fg: "#9F1239" },
  ];
  let hash = 0;
  for (let i = 0; i < propertyId.length; i++) {
    hash = (hash * 31 + propertyId.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

export function propertyInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Short label used in compact UI (tabs, badges). Strips a leading city/prefix
 * separated by a dash and a leading "The " article so "Dallas - The Scandi"
 * becomes "Scandi". Falls back to the original name if nothing to strip.
 * Final result is clipped to `maxChars` so it always fits under a 40px tile.
 */
export function shortPropertyName(name: string, maxChars = 9): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s*[-–—]\s*/).filter(Boolean);
  const tail = (parts[parts.length - 1] ?? trimmed).trim();
  const withoutThe = tail.replace(/^the\s*/i, "").trim();
  const label = withoutThe || tail;
  if (label.length <= maxChars) return label;
  return `${label.slice(0, maxChars - 1).trimEnd()}…`;
}
