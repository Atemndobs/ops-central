"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import { MessageSquare, MessageCircleMore, Copy, ExternalLink } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import { getErrorMessage } from "@/lib/errors";

type JobConversationLanesPanelProps = {
  jobId: Id<"cleaningJobs">;
  fullHrefBase: "/messages";
};

type WhatsAppLane = {
  cleaner: {
    _id: Id<"users">;
    name?: string | null;
    email: string;
    phone?: string | null;
  };
  conversationId: Id<"conversations"> | null;
  lastMessageAt?: number | null;
  lastMessagePreview?: string | null;
  unread: boolean;
  messagingEndpoint: {
    phoneNumber: string;
    serviceWindowClosesAt?: number;
    isServiceWindowOpen: boolean;
  } | null;
};

function formatRelativeTime(value?: number | null) {
  if (!value) return "No messages yet";
  const diff = Date.now() - value;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatWindow(value?: number | null) {
  if (!value) return "Await cleaner reply";
  return `Open until ${new Date(value).toLocaleString()}`;
}

export function JobConversationLanesPanel({
  jobId,
  fullHrefBase,
}: JobConversationLanesPanelProps) {
  const detail = useQuery(api.conversations.queries.getConversationLanesForJob, { jobId });
  const createInvite = useAction(api.whatsapp.actions.createLaneInvite);
  const { showToast } = useToast();
  const [pendingCleanerId, setPendingCleanerId] = useState<string | null>(null);
  const [inviteUrls, setInviteUrls] = useState<Record<string, string>>({});

  const lanes = useMemo(
    () => (detail?.whatsappLanes ?? []) as WhatsAppLane[],
    [detail?.whatsappLanes],
  );

  if (detail === undefined) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted-foreground)]">
        Loading communications...
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Communications</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            Internal thread plus one WhatsApp lane per assigned cleaner
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-2">
              <MessageSquare className="h-4 w-4 text-[var(--primary)]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-[var(--foreground)]">Internal team thread</p>
                {detail.internalConversation?.unread ? (
                  <span className="inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[var(--destructive)] px-1.5 text-[10px] font-bold text-white">
                    New
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {detail.internalConversation?.lastMessagePreview ?? "No messages yet for this job."}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-[var(--muted-foreground)]">
              {formatRelativeTime(detail.internalConversation?.lastMessageAt)}
            </p>
            <Link
              href={
                detail.internalConversation?._id
                  ? `${fullHrefBase}?conversationId=${detail.internalConversation._id}`
                  : fullHrefBase
              }
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:opacity-80"
            >
              Open thread
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {lanes.map((lane) => {
          const cleanerKey = String(lane.cleaner._id);
          const inviteUrl = inviteUrls[cleanerKey];

          return (
            <div
              key={cleanerKey}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-2">
                    <MessageCircleMore className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-[var(--foreground)]">
                        {lane.cleaner.name ?? lane.cleaner.email ?? "Cleaner"}
                      </p>
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                        WhatsApp
                      </span>
                      {lane.unread ? (
                        <span className="inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[var(--destructive)] px-1.5 text-[10px] font-bold text-white">
                          New
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {lane.lastMessagePreview ?? "No WhatsApp message yet."}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      {lane.messagingEndpoint?.phoneNumber ?? lane.cleaner.phone ?? "No linked phone yet"}
                    </p>
                    <p
                      className={`mt-1 text-xs ${
                        lane.messagingEndpoint?.isServiceWindowOpen
                          ? "text-emerald-400"
                          : "text-[var(--muted-foreground)]"
                      }`}
                    >
                      {lane.messagingEndpoint?.isServiceWindowOpen
                        ? formatWindow(lane.messagingEndpoint.serviceWindowClosesAt)
                        : "Await cleaner reply"}
                    </p>
                    {inviteUrl ? (
                      <p className="mt-2 break-all text-xs text-[var(--primary)]">
                        {inviteUrl}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {formatRelativeTime(lane.lastMessageAt)}
                  </p>
                  {lane.conversationId ? (
                    <Link
                      href={`${fullHrefBase}?conversationId=${lane.conversationId}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:opacity-80"
                    >
                      Open lane
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    disabled={pendingCleanerId === cleanerKey}
                    onClick={async () => {
                      setPendingCleanerId(cleanerKey);
                      try {
                        const result = await createInvite({
                          jobId,
                          cleanerUserId: lane.cleaner._id,
                        });
                        setInviteUrls((current) => ({
                          ...current,
                          [cleanerKey]: result.inviteUrl,
                        }));
                        if (navigator.clipboard?.writeText) {
                          await navigator.clipboard.writeText(result.inviteUrl);
                          showToast("WhatsApp invite link copied.");
                        } else {
                          showToast("WhatsApp invite link created.");
                        }
                      } catch (error) {
                        showToast(
                          getErrorMessage(error, "Unable to create WhatsApp invite."),
                          "error",
                        );
                      } finally {
                        setPendingCleanerId(null);
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
                  >
                    <Copy className="h-3 w-3" />
                    {lane.messagingEndpoint ? "Copy fresh link" : "Create invite link"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
