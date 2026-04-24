"use client";

import Image from "next/image";
import { useState } from "react";
import { MessageCircle, ChevronRight } from "lucide-react";
import { formatListTime, propertyInitial, propertyTileColor, type PropertyGroup } from "./helpers";

type PropertyMessageCardProps = {
  group: PropertyGroup;
  selected: boolean;
  onClick: () => void;
};

export function PropertyMessageCard({ group, selected, onClick }: PropertyMessageCardProps) {
  const tile = propertyTileColor(group.propertyId);
  const initial = propertyInitial(group.propertyName);
  const hasNew = group.unreadCount > 0;
  const showInternal = !hasNew && group.hasWhatsApp === false && group.conversations.length > 0;
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(group.propertyImageUrl) && !imageFailed;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`msg-card group flex w-full items-start gap-3 p-3 text-left transition-all hover:translate-y-[-1px] hover:shadow-[0_4px_14px_rgba(0,0,0,0.08)] focus:outline-none focus:ring-2 focus:ring-[var(--msg-primary)] focus:ring-offset-2 focus:ring-offset-[var(--msg-surface)] ${
        selected
          ? "ring-2 ring-[var(--msg-primary)] ring-offset-2 ring-offset-[var(--msg-surface)]"
          : ""
      }`}
    >
      {showImage ? (
        <span
          aria-hidden
          className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl"
          style={{ backgroundColor: tile.bg }}
        >
          <Image
            src={group.propertyImageUrl!}
            alt=""
            fill
            sizes="56px"
            unoptimized
            className="object-cover"
            onError={() => setImageFailed(true)}
          />
        </span>
      ) : (
        <span
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-lg font-bold"
          style={{ backgroundColor: tile.bg, color: tile.fg }}
        >
          {initial}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold leading-tight text-[var(--msg-text)]">
              {group.propertyName}
            </p>
            {group.propertyAddress ? (
              <p className="truncate text-[12px] text-[var(--msg-text-muted)]">
                {group.propertyAddress}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {hasNew ? (
              <span
                className="msg-label rounded-[4px] px-1.5 py-0.5"
                style={{ backgroundColor: "var(--msg-new-bg)", color: "var(--msg-new-fg)" }}
              >
                New
              </span>
            ) : showInternal ? (
              <span
                className="msg-label rounded-[4px] px-1.5 py-0.5"
                style={{ backgroundColor: "var(--msg-internal-bg)", color: "var(--msg-internal-fg)" }}
              >
                Internal
              </span>
            ) : null}
            <span className="text-[11px] text-[var(--msg-text-muted)]">
              {formatListTime(group.latestMessageAt)}
            </span>
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-[var(--msg-text-dim)]">
          <MessageCircle
            aria-hidden
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: "var(--msg-primary)" }}
          />
          <span className="truncate">
            {group.latestMessagePreview ?? "No messages yet"}
          </span>
          <ChevronRight
            aria-hidden
            className="ml-auto h-4 w-4 shrink-0 text-[var(--msg-text-muted)] transition-transform group-hover:translate-x-0.5"
          />
        </div>
      </div>
    </button>
  );
}
