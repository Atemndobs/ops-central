"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import { ConversationThread } from "./conversation-thread";

type MessagesInboxClientProps = {
  basePath: "/messages" | "/cleaner/messages";
  title: string;
};

function formatListTime(timestamp?: number) {
  if (!timestamp) {
    return "No messages";
  }
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MessagesInboxClient({
  basePath,
  title,
}: MessagesInboxClientProps) {
  const conversations = useQuery(api.conversations.queries.listMyConversations, {});
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const selectedConversationId = useMemo(() => {
    const raw = searchParams.get("conversationId");
    return raw as Id<"conversations"> | null;
  }, [searchParams]);

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
    selectedConversationId && conversations.some((item) => item._id === selectedConversationId)
      ? selectedConversationId
      : conversations[0]._id;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h1 className="text-lg font-bold text-[var(--foreground)]">{title}</h1>
          <p className="text-xs text-[var(--muted-foreground)]">
            Shared job-linked conversations
          </p>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          {conversations.map((conversation) => {
            const href = `${basePath}?conversationId=${conversation._id}`;
            const selected = conversation._id === selectedId;
            return (
              <Link
                key={conversation._id}
                href={href}
                className={`block border-b border-[var(--border)] px-4 py-3 transition-colors ${
                  selected ? "bg-[var(--primary)]/10" : "hover:bg-[var(--accent)]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                      {conversation.property?.name ?? "Unknown property"}
                    </p>
                    <p className="truncate text-xs text-[var(--muted-foreground)]">
                      {conversation.lastMessagePreview ?? "No messages yet"}
                    </p>
                  </div>
                  {conversation.unread ? (
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--primary)]" />
                  ) : null}
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-[var(--muted-foreground)]">
                  <span>{conversation.linkedJob ? `Job ${String(conversation.linkedJob._id).slice(-8)}` : "Thread"}</span>
                  <span>{formatListTime(conversation.lastMessageAt)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </aside>

      <section>
        <ConversationThread
          conversationId={selectedId}
          fullHref={null}
        />
      </section>
    </div>
  );
}
