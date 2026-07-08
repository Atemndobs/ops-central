"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { propertyInitial, propertyTileColor, type PropertyGroup } from "./helpers";

type PropertyPickerModalProps = {
  open: boolean;
  groups: PropertyGroup[];
  activePropertyId: string | null;
  onClose: () => void;
  onSelect: (group: PropertyGroup) => void;
};

export function PropertyPickerModal({
  open,
  groups,
  activePropertyId,
  onClose,
  onSelect,
}: PropertyPickerModalProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.propertyName.toLowerCase().includes(q) ||
        (g.propertyAddress ?? "").toLowerCase().includes(q),
    );
  }, [groups, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your properties"
        onClick={(e) => e.stopPropagation()}
        className="msg-card flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-b-none sm:h-auto sm:max-h-[80vh] sm:rounded-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--msg-divider)] px-4 py-3">
          <div>
            <h2 className="text-[18px] font-bold text-[var(--msg-text)]">Your properties</h2>
            <p className="text-[12px] text-[var(--msg-text-muted)]">
              {groups.length} with conversations
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--msg-text-dim)] hover:bg-[var(--msg-surface)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="border-b border-[var(--msg-divider)] px-4 py-2.5">
          <label className="flex items-center gap-2 rounded-full border border-[var(--msg-bubble-border)] bg-[var(--msg-surface)] px-3 py-2">
            <Search aria-hidden className="h-4 w-4 text-[var(--msg-text-muted)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search properties"
              className="flex-1 bg-transparent text-sm text-[var(--msg-text)] outline-none placeholder:text-[var(--msg-text-muted)]"
              autoFocus
            />
          </label>
        </div>
        <ul className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-[var(--msg-text-muted)]">
              No properties match &ldquo;{query}&rdquo;.
            </li>
          ) : (
            filtered.map((group) => {
              const tile = propertyTileColor(group.propertyId);
              const initial = propertyInitial(group.propertyName);
              const active = group.propertyId === activePropertyId;
              return (
                <li key={group.propertyId}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(group);
                      onClose();
                    }}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--msg-surface)] ${
                      active ? "bg-[var(--msg-primary-container)]/40" : ""
                    }`}
                  >
                    {group.propertyImageUrl ? (
                      <span
                        aria-hidden
                        className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg"
                        style={{ backgroundColor: tile.bg }}
                      >
                        <Image
                          src={group.propertyImageUrl}
                          alt=""
                          fill
                          sizes="40px"
                          unoptimized
                          className="object-cover"
                        />
                      </span>
                    ) : (
                      <span
                        aria-hidden
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
                        style={{ backgroundColor: tile.bg, color: tile.fg }}
                      >
                        {initial}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-[var(--msg-text)]">
                        {group.propertyName}
                      </span>
                      {group.propertyAddress ? (
                        <span className="block truncate text-[12px] text-[var(--msg-text-muted)]">
                          {group.propertyAddress}
                        </span>
                      ) : null}
                    </span>
                    {group.unreadCount > 0 ? (
                      <span
                        className="msg-label rounded-[4px] px-1.5 py-0.5"
                        style={{
                          backgroundColor: "var(--msg-new-bg)",
                          color: "var(--msg-new-fg)",
                        }}
                      >
                        {group.unreadCount} new
                      </span>
                    ) : null}
                    {active ? (
                      <Check
                        aria-hidden
                        className="h-4 w-4 shrink-0"
                        style={{ color: "var(--msg-primary)" }}
                      />
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
