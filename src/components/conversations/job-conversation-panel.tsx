"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";
import { ArrowRight, MessageSquare } from "lucide-react";

function formatPreviewTime(timestamp?: number | null) {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function initialsFor(name?: string | null, email?: string | null): string {
  const source = (name || email || "").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return source.slice(0, 1).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

type LatestMessageAuthor = {
  _id: Id<"users">;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
};

type LatestMessage = {
  _id: Id<"conversationMessages">;
  body?: string | null;
  createdAt: number;
  authorKind: "user" | "system" | "external_contact";
  author?: LatestMessageAuthor | null;
  authorEndpoint?: { displayName?: string | null; phoneNumber?: string | null } | null;
};

type ConversationDetail = {
  _id: Id<"conversations">;
  messages: LatestMessage[];
  unread?: boolean;
  lastMessageAt?: number | null;
  lastMessagePreview?: string | null;
};

type JobConversationPanelProps = {
  jobId: Id<"cleaningJobs">;
  fullHrefBase: "/messages" | "/cleaner/messages";
  compact?: boolean;
};

export function JobConversationPanel({
  jobId,
  fullHrefBase,
}: JobConversationPanelProps) {
  const t = useTranslations();
  const summary = useQuery(api.conversations.queries.getConversationForJob, { jobId });
  const ensureConversation = useMutation(api.conversations.mutations.ensureJobConversation);
  const ensureAttemptedRef = useRef(false);
  const { showToast } = useToast();

  const profile = useQuery(api.users.queries.getMyProfile, {}) as
    | { _id?: Id<"users">; avatarUrl?: string | null }
    | null
    | undefined;

  const conversationId = summary?._id ?? null;
  const detail = useQuery(
    api.conversations.queries.getConversationById,
    conversationId ? { conversationId, limit: 1 } : "skip",
  ) as ConversationDetail | null | undefined;
  const latest = detail?.messages?.[detail.messages.length - 1] ?? null;

  useEffect(() => {
    if (summary !== null || ensureAttemptedRef.current) {
      return;
    }

    ensureAttemptedRef.current = true;
    void ensureConversation({ jobId }).catch((error) => {
      ensureAttemptedRef.current = false;
      showToast(getErrorMessage(error, t("cleaner.unableToOpenConversation")), "error");
    });
  }, [ensureConversation, jobId, showToast, summary, t]);

  if (summary === undefined) {
    return (
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <MessageSquare className="h-4 w-4" />
          {t("cleaner.loadingMessages")}
        </div>
      </div>
    );
  }

  const fullHref =
    conversationId != null ? `${fullHrefBase}?conversationId=${conversationId}` : fullHrefBase;

  const hasMessages = Boolean(summary?.lastMessagePreview || latest?.body);
  const myUserId = profile?._id ?? null;
  const isSelfAuthor = myUserId !== null && latest?.author?._id === myUserId;

  const senderName = isSelfAuthor
    ? t("cleaner.youSender")
    : latest?.author?.name ??
      latest?.author?.email ??
      latest?.authorEndpoint?.displayName ??
      latest?.authorEndpoint?.phoneNumber ??
      (latest?.authorKind === "system" ? t("cleaner.system") : null);

  const avatarUrl = latest?.author?.avatarUrl ?? (isSelfAuthor ? profile?.avatarUrl ?? null : null);
  const previewBody =
    latest?.body && latest.body.trim().length > 0
      ? latest.body
      : summary?.lastMessagePreview ?? "";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">{t("cleaner.messagesHeading")}</h3>
          {summary?.unread ? (
            <span className="inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[var(--destructive)] px-1.5 text-[10px] font-bold text-white">
              {t("cleaner.newBadge")}
            </span>
          ) : null}
        </div>

        <Link
          href={fullHref}
          className="flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:opacity-80"
        >
          {hasMessages ? t("cleaner.openConversation") : t("cleaner.startConversation")}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {hasMessages ? (
        <Link
          href={fullHref}
          className="block rounded-[12px] border border-[var(--border)] bg-[var(--card)] p-3 transition-colors hover:bg-[var(--accent)]"
        >
          <div className="flex items-center gap-3">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={senderName ?? t("cleaner.system")}
                width={36}
                height={36}
                className="h-9 w-9 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--primary)] text-sm font-bold text-white">
                {initialsFor(senderName, latest?.author?.email)}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                  {senderName ?? t("cleaner.system")}
                </p>
                <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">
                  {formatPreviewTime(latest?.createdAt ?? summary?.lastMessageAt)}
                </span>
              </div>
              <p
                className={`truncate text-sm ${summary?.unread ? "font-semibold text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}
              >
                {previewBody}
              </p>
            </div>
          </div>
        </Link>
      ) : (
        <div className="rounded-[12px] border border-dashed border-[var(--border)] bg-[var(--card)] p-3">
          <p className="text-xs text-[var(--muted-foreground)]">
            {t("cleaner.noMessagesForJob")}
          </p>
        </div>
      )}
    </div>
  );
}
