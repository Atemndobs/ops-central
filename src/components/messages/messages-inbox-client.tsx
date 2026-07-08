"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import { ConversationThread } from "@/components/conversations/conversation-thread";
import { PropertyMessageList } from "./property-message-list";
import { PropertyTabStrip } from "./property-tab-strip";
import { PropertyPickerModal } from "./property-picker-modal";
import { groupByProperty, type ConversationItem, type PropertyGroup } from "./helpers";

type MessagesInboxClientProps = {
  /**
   * When true, always render single-pane (mobile layout) regardless of viewport width.
   * Used by the cleaner PWA whose shell is constrained to 402px.
   */
  forceSinglePane?: boolean;
};

function pickConversationForProperty(group: PropertyGroup): Id<"conversations"> | null {
  const first = group.currentConversations[0] ?? group.olderConversations[0];
  return first ? first._id : null;
}

export function MessagesInboxClient({ forceSinglePane = false }: MessagesInboxClientProps) {
  const { isAuthenticated } = useConvexAuth();
  const conversations = useQuery(
    api.conversations.queries.listMyConversations,
    isAuthenticated ? {} : "skip",
  );
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const conversationList = useMemo<ConversationItem[]>(
    () => (conversations ?? []) as ConversationItem[],
    [conversations],
  );
  const hasLoaded = conversations !== undefined;

  const groups = useMemo(() => groupByProperty(conversationList), [conversationList]);

  const selectedConversationId = useMemo(() => {
    const raw = searchParams.get("conversationId");
    return raw as Id<"conversations"> | null;
  }, [searchParams]);

  const selectedConversation = useMemo(
    () => conversationList.find((c) => c._id === selectedConversationId) ?? null,
    [conversationList, selectedConversationId],
  );
  const selectedPropertyId = selectedConversation?.property?._id ?? null;
  const [pickerOpen, setPickerOpen] = useState(false);

  // Auto-select first group's conversation on desktop when nothing is selected.
  useEffect(() => {
    if (forceSinglePane) return;
    if (!hasLoaded || groups.length === 0 || selectedConversationId) return;
    if (typeof window === "undefined") return;
    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    if (!isDesktop) return;

    const firstId = pickConversationForProperty(groups[0]);
    if (!firstId) return;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("conversationId", firstId);
    router.replace(`${pathname}?${nextParams.toString()}`);
  }, [forceSinglePane, hasLoaded, groups, pathname, router, searchParams, selectedConversationId]);

  function selectProperty(group: PropertyGroup) {
    const convId = pickConversationForProperty(group);
    if (!convId) return;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("conversationId", convId);
    router.replace(`${pathname}?${nextParams.toString()}`);
  }

  function handleBack() {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("conversationId");
    router.replace(nextParams.size > 0 ? `${pathname}?${nextParams.toString()}` : pathname);
  }

  if (!hasLoaded) {
    return (
      <p className="text-sm text-[var(--msg-text-muted)]">Loading messages...</p>
    );
  }

  const mobileShowingThread = selectedConversationId !== null;

  if (forceSinglePane) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {mobileShowingThread && selectedConversationId ? (
          <>
            <button
              type="button"
              onClick={handleBack}
              className="flex shrink-0 items-center gap-2 text-sm font-semibold text-[var(--msg-primary)] hover:opacity-80"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to messages
            </button>
            <div className="shrink-0">
              <PropertyTabStrip
                groups={groups}
                activePropertyId={selectedPropertyId}
                onSelect={selectProperty}
                onOpenPicker={() => setPickerOpen(true)}
              />
            </div>
            <div className="min-h-0 flex-1">
              <ConversationThread
                conversationId={selectedConversationId}
                fullHref={null}
                fillHeight
              />
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PropertyMessageList
              groups={groups}
              selectedPropertyId={selectedPropertyId}
              onSelectProperty={selectProperty}
            />
          </div>
        )}

        <PropertyPickerModal
          open={pickerOpen}
          groups={groups}
          activePropertyId={selectedPropertyId}
          onClose={() => setPickerOpen(false)}
          onSelect={selectProperty}
        />
      </div>
    );
  }

  return (
    <>
      {/* ── Desktop: split pane (list 360px + thread flex-1) ───────── */}
      <div className="hidden gap-5 lg:grid lg:grid-cols-[360px_minmax(0,1fr)]">
        <div>
          <PropertyMessageList
            groups={groups}
            selectedPropertyId={selectedPropertyId}
            onSelectProperty={selectProperty}
          />
        </div>
        <section className="flex flex-col">
          {selectedConversationId ? (
            <>
              <PropertyTabStrip
                groups={groups}
                activePropertyId={selectedPropertyId}
                onSelect={selectProperty}
                onOpenPicker={() => setPickerOpen(true)}
              />
              <ConversationThread conversationId={selectedConversationId} fullHref={null} />
            </>
          ) : (
            <div className="msg-card flex min-h-[20rem] items-center justify-center p-8 text-center">
              <p className="text-sm text-[var(--msg-text-muted)]">
                Select a property to open its conversation.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* ── Tablet / mobile (admin dashboard only): single pane ───── */}
      <div className="lg:hidden">
        {mobileShowingThread ? (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-2 text-sm font-semibold text-[var(--msg-primary)] hover:opacity-80"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to messages
            </button>
            {selectedConversationId ? (
              <>
                <PropertyTabStrip
                  groups={groups}
                  activePropertyId={selectedPropertyId}
                  onSelect={selectProperty}
                  onOpenPicker={() => setPickerOpen(true)}
                />
                <ConversationThread conversationId={selectedConversationId} fullHref={null} />
              </>
            ) : null}
          </div>
        ) : (
          <PropertyMessageList
            groups={groups}
            selectedPropertyId={selectedPropertyId}
            onSelectProperty={selectProperty}
          />
        )}
      </div>

      <PropertyPickerModal
        open={pickerOpen}
        groups={groups}
        activePropertyId={selectedPropertyId}
        onClose={() => setPickerOpen(false)}
        onSelect={selectProperty}
      />
    </>
  );
}
