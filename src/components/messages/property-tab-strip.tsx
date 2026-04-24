"use client";

import Image from "next/image";
import { ChevronDown } from "lucide-react";
import {
  propertyInitial,
  propertyTileColor,
  shortPropertyName,
  type PropertyGroup,
} from "./helpers";

const MAX_VISIBLE_TABS = 4;
const ACTIVE_TAB_WIDTH = 246;
const INACTIVE_TAB_WIDTH = 72;
const STACK_OVERLAP = 36;
// Small overlap used next to the active tab so edges touch without hiding
// content — replaces the visible gap that was there before.
const TOUCH_OVERLAP = 8;

type PropertyTabStripProps = {
  groups: PropertyGroup[];
  activePropertyId: string | null;
  onSelect: (group: PropertyGroup) => void;
  onOpenPicker: () => void;
};

function compactAddress(address?: string): string | null {
  if (!address) return null;
  const firstChunk = address.split(",")[0]?.trim() ?? "";
  if (!firstChunk) return null;
  return firstChunk.length > 30 ? `${firstChunk.slice(0, 29).trimEnd()}…` : firstChunk;
}

/** Very short address label used on the narrow inactive tab. */
function tinyAddress(address?: string, maxChars = 11): string | null {
  if (!address) return null;
  const firstChunk = address.split(",")[0]?.trim() ?? "";
  if (!firstChunk) return null;
  return firstChunk.length > maxChars
    ? `${firstChunk.slice(0, maxChars - 1).trimEnd()}…`
    : firstChunk;
}

export function PropertyTabStrip({
  groups,
  activePropertyId,
  onSelect,
  onOpenPicker,
}: PropertyTabStripProps) {
  if (groups.length <= 1) {
    return null;
  }

  const overflow = groups.length > MAX_VISIBLE_TABS;
  const activeGroup = groups.find((g) => g.propertyId === activePropertyId) ?? null;

  let tabs: PropertyGroup[];
  if (!overflow) {
    tabs = groups.slice(0, MAX_VISIBLE_TABS);
  } else {
    const topThree = groups.slice(0, MAX_VISIBLE_TABS - 1);
    if (activeGroup && !topThree.some((g) => g.propertyId === activeGroup.propertyId)) {
      tabs = [...topThree, activeGroup];
    } else {
      tabs = groups.slice(0, MAX_VISIBLE_TABS);
    }
  }

  // Index of the active tab inside the rendered slice; -1 if the user has
  // no active selection. Used below to make the tab nearest to active sit
  // on top of the stack, so its full thumbnail + label stay visible.
  const activeTabIndex = tabs.findIndex(
    (t) => t.propertyId === activePropertyId,
  );
  return (
    <div className="flex items-start gap-2 border-b border-[var(--msg-divider)] bg-[var(--msg-card)] px-3 py-2 lg:rounded-t-2xl">
      <div
        role="tablist"
        aria-label="Property conversations"
        className="flex min-w-0 flex-1 items-center overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((group, index) => {
          const active = group.propertyId === activePropertyId;
          const prev = index > 0 ? tabs[index - 1] : null;
          const next = index < tabs.length - 1 ? tabs[index + 1] : null;
          const prevActive = prev ? prev.propertyId === activePropertyId : false;
          const nextActive = next ? next.propertyId === activePropertyId : false;
          // Tab right after the active, and the active tab itself, use a
          // small overlap so edges touch (no padding gap). All other
          // inactive→inactive transitions keep the stacked overlap look.
          const marginLeft =
            index === 0
              ? 0
              : prevActive || active
                ? -TOUCH_OVERLAP
                : -STACK_OVERLAP;
          // The label (tiny address) sits below the thumbnail at full tab
          // width. Among stacked inactive tabs, only the one whose
          // thumbnail and label are fully visible should render text —
          // otherwise adjacent labels collide. We elevate the tab nearest
          // the active selection via zIndex (see below), so the label
          // rules are:
          //   • the active tab itself always shows its label
          //   • the tab immediately before or after the active tab (its
          //     "neighbour") is on top of the deck and shows its label
          //   • every other inactive tab is stacked behind — hide its
          //     label to avoid collisions, and fall back to the native
          //     tooltip (title/aria-label) for identification
          const showLabel = active || prevActive || nextActive;
          // Layer order. Active sits on top. Inactive tabs closer to the
          // active selection take precedence over further ones so the
          // "nearest unseen conversation" is fully visible — users almost
          // always want to see *what's next to where they are*, not the
          // furthest tab in the deck.
          const distanceFromActive =
            activeTabIndex >= 0 ? Math.abs(index - activeTabIndex) : index;
          const zIndex = active
            ? 50
            : Math.max(1, 40 - distanceFromActive);
          const tile = propertyTileColor(group.propertyId);
          const initial = propertyInitial(group.propertyName);
          const shortName = shortPropertyName(group.propertyName, active ? 18 : 10);
          const address = compactAddress(group.propertyAddress);
          return (
            <button
              key={group.propertyId}
              role="tab"
              aria-selected={active}
              aria-label={group.propertyName}
              title={group.propertyName}
              type="button"
              onClick={() => onSelect(group)}
              className={`group relative shrink-0 rounded-[20px] text-left transition-all focus:outline-none ${
                active
                  ? "border bg-[var(--msg-surface)] ring-2 ring-[var(--msg-primary)]/20"
                  : "bg-transparent hover:-translate-y-0.5"
              }`}
              style={{
                width: active ? ACTIVE_TAB_WIDTH : INACTIVE_TAB_WIDTH,
                marginLeft,
                borderColor: active ? "var(--msg-primary)" : undefined,
                boxShadow: active ? "var(--msg-shadow-float)" : undefined,
                zIndex,
              }}
            >
              <span
                className={`flex ${
                  active
                    ? "items-center gap-2 p-2"
                    : "flex-col items-center gap-1 px-1.5 py-1.5"
                }`}
              >
                <span
                  className={`relative overflow-hidden rounded-[18px] ${
                    active
                      ? "h-[58px] w-[58px] shrink-0 border"
                      : "h-[52px] w-[52px] shrink-0"
                  }`}
                  style={{
                    backgroundColor: tile.bg,
                    borderColor: active ? "var(--msg-primary-container)" : undefined,
                  }}
                >
                  {group.propertyImageUrl ? (
                    <Image
                      src={group.propertyImageUrl}
                      alt={group.propertyName}
                      fill
                      sizes={active ? "58px" : "52px"}
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className={`flex h-full w-full items-center justify-center font-bold ${
                        active ? "text-xl" : "text-sm"
                      }`}
                      style={{ color: tile.fg }}
                    >
                      {initial}
                    </span>
                  )}
                  {group.unreadCount > 0 ? (
                    <span
                      aria-label={`${group.unreadCount} unread`}
                      className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--msg-card)]"
                      style={{ backgroundColor: "var(--msg-primary)" }}
                    />
                  ) : null}
                </span>
                {active ? (
                  <span className="min-w-0 flex-1 pr-0.5">
                    <span className="block truncate text-[13px] font-extrabold uppercase tracking-[0.05em] text-[var(--msg-primary-strong)]">
                      {address ?? shortName}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-medium text-[var(--msg-text-muted)]">
                      {group.propertyName}
                    </span>
                  </span>
                ) : showLabel ? (
                  <span
                    className="block w-full truncate text-center text-[10px] font-semibold leading-tight text-[var(--msg-text-dim)]"
                  >
                    {tinyAddress(group.propertyAddress) ?? shortName}
                  </span>
                ) : (
                  // Stacked inactive tab — suppress the label so it doesn't
                  // collide with the next tab's label. Reserve the vertical
                  // space so thumbnails stay vertically aligned across the
                  // strip, otherwise the stacked tabs would shift up.
                  <span
                    aria-hidden
                    className="block h-[14px] w-full"
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>
      {overflow ? (
        <button
          type="button"
          onClick={onOpenPicker}
          aria-label={`View all ${groups.length} properties`}
          className="inline-flex h-[92px] shrink-0 flex-col items-center justify-center gap-1 rounded-[20px] border border-[var(--msg-bubble-border)] bg-[var(--msg-card)] px-3 text-[11px] font-semibold leading-tight text-[var(--msg-primary-strong)] hover:bg-[var(--msg-surface)]"
        >
          <span>+{groups.length - tabs.length}</span>
          <span>View all</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
