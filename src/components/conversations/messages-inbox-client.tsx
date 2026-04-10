"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import { ArrowLeft } from "lucide-react";
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
  unreadCount: number;
};

function groupByProperty(conversations: ConversationItem[]): PropertyGroup[] {
  const map = new Map<string, PropertyGroup>();

  for (const conv of conversations) {
    const propId = conv.property?._id ?? "unknown";
    const propName = conv.property?.name ?? "Unknown Property";

    if (!map.has(propId)) {
      map.set(propId, {
        propertyId: propId,
        propertyName: propName,
        conversations: [],
        unreadCount: 0,
      });
    }

    const group = map.get(propId)!;
    group.conversations.push(conv);
    if (conv.unread) {
      group.unreadCount++;
    }
  }

  // Sort groups: groups with unread messages first, then by most recent message
  return Array.from(map.values()).sort((a, b) => {
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

  const selectedConversationId = useMemo(() => {
    const raw = searchParams.get("conversationId");
    return raw as Id<"conversations"> | null;
  }, [searchParams]);

  // Auto-select first conversation on desktop
  useEffect(() => {
    if (!conversations || conversations.length === 0 || selectedConversationId) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("conversationId", conversations[0]._id);
    router.replace(`${pathname}?${nextParams.toString()}`);
  }, [conversations, pathname, router, searchParams, selectedConversationId]);

  if (conversations === undefined) {
    return <div className="text-sm text-[var(--muted-foreground)]">Loading messages...</div>;
  }

  if (conversations.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] p-8 text-center">
        <h1 className="text-xl font-bold text-[var(--foreground)]">{title}</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Conversations appear here after someone opens chat from a job.
        </p>
      </div>
    );
  }

  const selectedId =
    selectedConversationId &&
    conversations.some(
      (item: ConversationItem) => item._id === selectedConversationId,
    )
      ? selectedConversationId
      : conversations[0]._id;

  const groups = groupByProperty(conversations as ConversationItem[]);

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

  return (
    <>
      {/* ─── DESKTOP: side-by-side ─── */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-[320px_minmax(0,1fr)]">
        <InboxList
          groups={groups}
          selectedId={selectedId}
          onSelect={selectConversation}
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
  title,
}: {
  groups: PropertyGroup[];
  selectedId: Id<"conversations">;
  onSelect: (id: Id<"conversations">) => void;
  title: string;
}) {
  const totalUnread = groups.reduce((sum, g) => sum + g.unreadCount, 0);

  return (
    <aside className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-[var(--foreground)]">{title}</h1>
          {totalUnread > 0 ? (
            <span className="inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[var(--destructive)] px-1.5 text-[11px] font-bold text-white">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">
          Job conversations grouped by property
        </p>
      </div>

      <div className="max-h-[75vh] overflow-y-auto">
        {groups.map((group) => (
          <div key={group.propertyId}>
            {/* Property group header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--accent)]/50 px-4 py-2 backdrop-blur-sm">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--primary)]">
                {group.propertyName}
              </span>
              {group.unreadCount > 0 ? (
                <span className="inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] font-bold text-white">
                  {group.unreadCount}
                </span>
              ) : null}
            </div>

            {/* Conversations in this group */}
            {group.conversations.map((conversation) => {
              const selected = conversation._id === selectedId;
              const jobSuffix = conversation.linkedJob
                ? String(conversation.linkedJob._id).slice(-6)
                : null;

              return (
                <button
                  key={conversation._id}
                  type="button"
                  onClick={() => onSelect(conversation._id)}
                  className={`block w-full border-b border-[var(--border)] px-4 py-3 text-left transition-colors ${
                    selected
                      ? "bg-[var(--primary)]/10"
                      : "hover:bg-[var(--accent)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={`truncate text-sm ${conversation.unread ? "font-bold text-[var(--foreground)]" : "font-medium text-[var(--foreground)]"}`}>
                          {conversation.laneKind === "whatsapp_cleaner"
                            ? conversation.linkedCleaner?.name ??
                              conversation.messagingEndpoint?.displayName ??
                              "WhatsApp lane"
                            : jobSuffix
                            ? `Job #${jobSuffix}`
                            : "Thread"}
                          {conversation.linkedJob?.status ? ` · ${conversation.linkedJob.status.replace(/_/g, " ")}` : ""}
                        </p>
                        <span
                          className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            conversation.laneKind === "whatsapp_cleaner"
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                              : "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)]"
                          }`}
                        >
                          {conversation.laneKind === "whatsapp_cleaner" ? "WhatsApp" : "Internal"}
                        </span>
                        {conversation.unread ? (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--primary)]" />
                        ) : null}
                      </div>
                      <p className={`mt-0.5 truncate text-xs ${conversation.unread ? "font-medium text-[var(--muted-foreground)]" : "text-[var(--muted-foreground)]"}`}>
                        {conversation.lastMessagePreview ?? "No messages yet"}
                      </p>
                      {conversation.laneKind === "whatsapp_cleaner" ? (
                        <p className="mt-1 truncate text-[11px] text-[var(--muted-foreground)]">
                          {conversation.messagingEndpoint?.phoneNumber ??
                            conversation.linkedCleaner?.phone ??
                            "Awaiting lane bootstrap"}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">
                      {formatListTime(conversation.lastMessageAt)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
