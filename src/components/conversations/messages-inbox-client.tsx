"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import { Archive, ArrowLeft, ChevronDown, ChevronRight, Home } from "lucide-react";
import { ConversationThread } from "./conversation-thread";

type MessagesInboxClientProps = {
  title: string;
};

function formatListTime(timestamp?: number) {
  if (!timestamp) {
    return "";
  }
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function formatSchedule(timestamp: number) {
  const date = new Date(timestamp);
  const datePart = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart} · ${timePart}`;
}

type ConversationItem = {
  _id: Id<"conversations">;
  laneKind: "internal_shared" | "whatsapp_cleaner";
  channel: "internal" | "sms" | "whatsapp" | "email";
  unread: boolean;
  lastMessageAt?: number;
  lastMessagePreview?: string;
  linkedJob: { _id: Id<"cleaningJobs">; status: string; scheduledStartAt?: number } | null;
  property: { _id: Id<"properties">; name: string; address?: string } | null;
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

type PropertyGroup = {
  propertyId: string;
  propertyName: string;
  conversations: ConversationItem[];
  currentConversations: ConversationItem[];
  olderConversations: ConversationItem[];
  unreadCount: number;
  latestMessageAt?: number;
  latestMessagePreview?: string;
};

function isCurrentOrUpcoming(
  conversation: ConversationItem,
  startOfTodayMs: number,
): boolean {
  // Unread always surfaces — never hide something the user hasn't read.
  if (conversation.unread) return true;
  // WhatsApp threads are permanent contact lanes, not tied to a specific job.
  if (conversation.laneKind === "whatsapp_cleaner") return true;
  const scheduledAt = conversation.linkedJob?.scheduledStartAt;
  if (scheduledAt === undefined) return true;
  return scheduledAt >= startOfTodayMs;
}

function groupByProperty(conversations: ConversationItem[]): PropertyGroup[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();

  const map = new Map<string, PropertyGroup>();

  for (const conv of conversations) {
    const propId = conv.property?._id ?? "unknown";
    const propName = conv.property?.name ?? "Unknown Property";

    if (!map.has(propId)) {
      map.set(propId, {
        propertyId: propId,
        propertyName: propName,
        conversations: [],
        currentConversations: [],
        olderConversations: [],
        unreadCount: 0,
        latestMessageAt: undefined,
        latestMessagePreview: undefined,
      });
    }

    const group = map.get(propId)!;
    group.conversations.push(conv);
    if (isCurrentOrUpcoming(conv, startOfTodayMs)) {
      group.currentConversations.push(conv);
    } else {
      group.olderConversations.push(conv);
    }
    if (conv.unread) {
      group.unreadCount++;
    }
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
    if (aSched !== bSched) return aSched - bSched; // current first, upcoming next
    return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
  };
  const sortByScheduledDesc = (a: ConversationItem, b: ConversationItem) => {
    const aSched = a.linkedJob?.scheduledStartAt ?? 0;
    const bSched = b.linkedJob?.scheduledStartAt ?? 0;
    return bSched - aSched; // most recent older first
  };

  // Sort groups: groups with unread messages first, then by most recent message
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

export function MessagesInboxClient({
  title,
}: MessagesInboxClientProps) {
  const { isAuthenticated } = useConvexAuth();
  const conversations = useQuery(
    api.conversations.queries.listMyConversations,
    isAuthenticated ? {} : "skip",
  );
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [expandedPropertyIds, setExpandedPropertyIds] = useState<Set<string>>(() => new Set());
  const [collapsedPropertyIds, setCollapsedPropertyIds] = useState<Set<string>>(() => new Set());
  const [showOlderPropertyIds, setShowOlderPropertyIds] = useState<Set<string>>(() => new Set());
  const conversationList = useMemo(() => conversations ?? [], [conversations]);
  const hasLoadedConversations = conversations !== undefined;

  const selectedConversationId = useMemo(() => {
    const raw = searchParams.get("conversationId");
    return raw as Id<"conversations"> | null;
  }, [searchParams]);

  // Auto-select first conversation on desktop only (mobile uses full-screen list/thread toggle)
  useEffect(() => {
    if (!conversations || conversations.length === 0 || selectedConversationId) {
      return;
    }

    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    if (!isDesktop) return;

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("conversationId", conversations[0]._id);
    router.replace(`${pathname}?${nextParams.toString()}`);
  }, [conversations, pathname, router, searchParams, selectedConversationId]);

  const selectedId = useMemo(() => {
    if (conversationList.length === 0) {
      return null;
    }

    if (
      selectedConversationId &&
      conversationList.some(
        (item: ConversationItem) => item._id === selectedConversationId,
      )
    ) {
      return selectedConversationId;
    }

    return conversationList[0]._id;
  }, [conversationList, selectedConversationId]);

  const groups = useMemo(
    () => groupByProperty(conversationList as ConversationItem[]),
    [conversationList],
  );
  const selectedConversation = useMemo(
    () => conversationList.find((item) => item._id === selectedId) ?? null,
    [conversationList, selectedId],
  );

  if (!hasLoadedConversations) {
    return <div className="text-sm text-[var(--muted-foreground)]">Loading messages...</div>;
  }

  if (conversationList.length === 0 || selectedId === null) {
    return (
      <div className="cleaner-card border-dashed p-8 text-center">
        <h1 className="cleaner-card-title">{title}</h1>
        <p className="mt-2 text-sm text-[var(--cleaner-muted)]">
          Conversations appear here after someone opens chat from a job.
        </p>
      </div>
    );
  }

  function selectConversation(conversationId: Id<"conversations">) {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("conversationId", conversationId);
    router.replace(`${pathname}?${nextParams.toString()}`);
  }

  function handleBack() {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("conversationId");
    router.replace(nextParams.size > 0 ? `${pathname}?${nextParams.toString()}` : pathname);
  }

  function toggleProperty(propertyId: string) {
    if (selectedConversation?.property?._id === propertyId) {
      setCollapsedPropertyIds((current) => {
        const next = new Set(current);
        if (next.has(propertyId)) {
          next.delete(propertyId);
        } else {
          next.add(propertyId);
        }
        return next;
      });
      return;
    }

    setExpandedPropertyIds((current) => {
      const next = new Set(current);
      if (next.has(propertyId)) {
        next.delete(propertyId);
      } else {
        next.add(propertyId);
      }
      return next;
    });
  }

  function toggleShowOlder(propertyId: string) {
    setShowOlderPropertyIds((current) => {
      const next = new Set(current);
      if (next.has(propertyId)) {
        next.delete(propertyId);
      } else {
        next.add(propertyId);
      }
      return next;
    });
  }

  return (
    <>
      {/* ─── DESKTOP: side-by-side ─── */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-[320px_minmax(0,1fr)]">
        <InboxList
          groups={groups}
          selectedId={selectedId}
          onSelect={selectConversation}
          expandedPropertyIds={expandedPropertyIds}
          collapsedPropertyIds={collapsedPropertyIds}
          showOlderPropertyIds={showOlderPropertyIds}
          activePropertyId={selectedConversation?.property?._id ?? null}
          onToggleProperty={toggleProperty}
          onToggleShowOlder={toggleShowOlder}
          title={title}
        />
        <section>
          <ConversationThread
            conversationId={selectedId}
            fullHref={null}
          />
        </section>
      </div>

      {/* ─── MOBILE: full-screen list OR full-screen thread ─── */}
      <div className="lg:hidden">
        {selectedConversationId && selectedId ? (
          <div className="flex flex-col">
            <button
              type="button"
              onClick={handleBack}
              className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--primary)] hover:opacity-80"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to messages
            </button>
            <ConversationThread
              conversationId={selectedId}
              fullHref={null}
            />
          </div>
        ) : (
          <InboxList
            groups={groups}
            selectedId={selectedId}
            onSelect={selectConversation}
            expandedPropertyIds={expandedPropertyIds}
            collapsedPropertyIds={collapsedPropertyIds}
            showOlderPropertyIds={showOlderPropertyIds}
            activePropertyId={selectedConversation?.property?._id ?? null}
            onToggleProperty={toggleProperty}
            onToggleShowOlder={toggleShowOlder}
            title={title}
          />
        )}
      </div>
    </>
  );
}

function InboxList({
  groups,
  selectedId,
  onSelect,
  expandedPropertyIds,
  collapsedPropertyIds,
  showOlderPropertyIds,
  activePropertyId,
  onToggleProperty,
  onToggleShowOlder,
  title,
}: {
  groups: PropertyGroup[];
  selectedId: Id<"conversations">;
  onSelect: (id: Id<"conversations">) => void;
  expandedPropertyIds: Set<string>;
  collapsedPropertyIds: Set<string>;
  showOlderPropertyIds: Set<string>;
  activePropertyId: string | null;
  onToggleProperty: (propertyId: string) => void;
  onToggleShowOlder: (propertyId: string) => void;
  title: string;
}) {
  const totalUnread = groups.reduce((sum, g) => sum + g.unreadCount, 0);

  function isPropertyExpanded(propertyId: string) {
    return propertyId === activePropertyId
      ? !collapsedPropertyIds.has(propertyId)
      : expandedPropertyIds.has(propertyId);
  }

  return (
    <aside className="cleaner-card overflow-hidden">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="cleaner-card-title text-[1.35rem]">{title}</h1>
          {totalUnread > 0 ? (
            <span className="inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[var(--destructive)] px-1.5 text-[11px] font-bold text-white">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-[var(--cleaner-muted)]">
          Job conversations grouped by property
        </p>
      </div>

      <div className="max-h-[75vh] overflow-y-auto">
        {groups.map((group) => (
          <section key={group.propertyId} className="border-b border-[var(--border)] last:border-b-0">
            <button
              type="button"
              onClick={() => onToggleProperty(group.propertyId)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--muted)]/45"
              aria-expanded={isPropertyExpanded(group.propertyId)}
            >
              <span
                aria-hidden
                className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)]/12 text-[var(--primary)]"
              >
                <Home className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-base font-bold tracking-tight text-[var(--foreground)]">
                    {group.propertyName}
                  </p>
                  <span className="rounded-full border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--cleaner-muted)]">
                    {group.conversations.length} job{group.conversations.length === 1 ? "" : "s"}
                  </span>
                  {group.unreadCount > 0 ? (
                    <span className="inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] font-bold text-white">
                      {group.unreadCount}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <p className="min-w-0 flex-1 truncate text-xs text-[var(--cleaner-muted)]">
                    {group.latestMessagePreview ?? "No messages yet"}
                  </p>
                  <span className="shrink-0 text-[11px] text-[var(--cleaner-muted)]">
                    {formatListTime(group.latestMessageAt)}
                  </span>
                </div>
              </div>
              {isPropertyExpanded(group.propertyId) ? (
                <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cleaner-muted)]" />
              ) : (
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cleaner-muted)]" />
              )}
            </button>

            {isPropertyExpanded(group.propertyId) ? (
              <div className="relative border-t border-[var(--border)] bg-[var(--muted)]/18 pl-10">
                <span
                  aria-hidden
                  className="pointer-events-none absolute bottom-3 left-[1.6rem] top-3 w-px bg-[var(--primary)]/25"
                />
                {(() => {
                  const olderVisible = showOlderPropertyIds.has(group.propertyId);
                  const visible = olderVisible
                    ? [...group.currentConversations, ...group.olderConversations]
                    : group.currentConversations;

                  if (visible.length === 0 && group.olderConversations.length > 0) {
                    return (
                      <p className="px-4 py-4 text-xs text-[var(--cleaner-muted)]">
                        No current or upcoming jobs — {group.olderConversations.length} older thread
                        {group.olderConversations.length === 1 ? "" : "s"} available.
                      </p>
                    );
                  }
                  return null;
                })()}
                {(showOlderPropertyIds.has(group.propertyId)
                  ? [...group.currentConversations, ...group.olderConversations]
                  : group.currentConversations
                ).map((conversation, idx) => {
                  const selected = conversation._id === selectedId;
                  const scheduleLabel = conversation.linkedJob?.scheduledStartAt
                    ? formatSchedule(conversation.linkedJob.scheduledStartAt)
                    : null;
                  const isFirstOlder =
                    showOlderPropertyIds.has(group.propertyId) &&
                    idx === group.currentConversations.length &&
                    group.olderConversations.length > 0;

                  return (
                    <div key={conversation._id}>
                      {isFirstOlder ? (
                        <div className="border-b border-[var(--border)]/60 px-4 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--cleaner-muted)]">
                          Older
                        </div>
                      ) : null}
                    <button
                      type="button"
                      onClick={() => onSelect(conversation._id)}
                      className={`block w-full border-b border-[var(--border)]/60 px-4 py-3 text-left transition-colors last:border-b-0 ${
                        selected
                          ? "bg-[var(--primary)]/10"
                          : "hover:bg-[var(--muted)]/25"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p
                              className={`truncate text-sm ${
                                conversation.unread
                                  ? "font-semibold text-[var(--foreground)]"
                                  : "font-normal text-[var(--cleaner-ink)]"
                              }`}
                            >
                              {conversation.laneKind === "whatsapp_cleaner"
                                ? conversation.linkedCleaner?.name ??
                                  conversation.messagingEndpoint?.displayName ??
                                  "WhatsApp lane"
                                : scheduleLabel ?? "Thread"}
                              {conversation.linkedJob?.status
                                ? ` · ${conversation.linkedJob.status.replace(/_/g, " ")}`
                                : ""}
                            </p>
                            <span
                              className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                conversation.laneKind === "whatsapp_cleaner"
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                                  : "border-[var(--border)] bg-[var(--background)] text-[var(--cleaner-muted)]"
                              }`}
                            >
                              {conversation.laneKind === "whatsapp_cleaner"
                                ? "WhatsApp"
                                : "Internal"}
                            </span>
                            {conversation.unread ? (
                              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--primary)]" />
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex items-baseline gap-2">
                            <p
                              className={`min-w-0 flex-1 truncate text-xs ${
                                conversation.unread
                                  ? "font-medium text-[var(--cleaner-muted)]"
                                  : "text-[var(--cleaner-muted)]"
                              }`}
                            >
                              {conversation.lastMessagePreview ?? "No messages yet"}
                            </p>
                            <span className="shrink-0 text-[11px] text-[var(--cleaner-muted)]">
                              {formatListTime(conversation.lastMessageAt)}
                            </span>
                          </div>
                          {conversation.laneKind === "whatsapp_cleaner" ? (
                            <p className="mt-1 truncate text-[11px] text-[var(--cleaner-muted)]">
                              {conversation.messagingEndpoint?.phoneNumber ??
                                conversation.linkedCleaner?.phone ??
                                "Awaiting lane bootstrap"}
                            </p>
                          ) : null}
                        </div>
                        <ChevronRight
                          aria-hidden
                          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cleaner-muted)]"
                        />
                      </div>
                    </button>
                    </div>
                  );
                })}
                {group.olderConversations.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => onToggleShowOlder(group.propertyId)}
                    className="flex w-full items-center gap-2 border-t border-[var(--border)]/60 px-4 py-2.5 text-left text-xs font-medium text-[var(--cleaner-muted)] transition-colors hover:bg-[var(--muted)]/25"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    <span>
                      {showOlderPropertyIds.has(group.propertyId)
                        ? `Hide ${group.olderConversations.length} older`
                        : `Show ${group.olderConversations.length} older`}
                    </span>
                    {showOlderPropertyIds.has(group.propertyId) ? (
                      <ChevronDown className="ml-auto h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="ml-auto h-3.5 w-3.5" />
                    )}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </aside>
  );
}
