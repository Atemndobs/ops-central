"use client";

import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, Loader2, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { SearchableSelectProps } from "./contract";
import { groupSearchableItems } from "./contract";
import { capture } from "@/lib/posthog/client";

export function SearchableSelect<Meta = unknown>({
  items,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  loading = false,
  clearable = true,
  disabled = false,
  groupOrder,
  id,
  name,
  "aria-label": ariaLabel,
}: SearchableSelectProps<Meta>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => items.find((item) => item.id === value) ?? null,
    [items, value],
  );

  const grouped = useMemo(
    () => groupSearchableItems(items, groupOrder),
    [items, groupOrder],
  );

  const triggerLabel = selected?.label ?? placeholder;
  const showClear = clearable && value !== null && !disabled;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
        if (next) {
          capture("searchable_select_opened", {
            surface: ariaLabel ?? placeholder,
            item_count: items.length,
          });
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          name={name}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          data-testid="searchable-select-trigger"
          className={[
            "inline-flex w-full items-center justify-between gap-2",
            "rounded-md border bg-[var(--card)] px-2 py-1.5 text-left text-sm",
            "text-[var(--foreground)]",
            "hover:bg-[var(--accent)]/30",
            "disabled:cursor-not-allowed disabled:opacity-60",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          ].join(" ")}
        >
          <span
            className={[
              "truncate",
              selected ? "" : "text-[var(--muted-foreground)]",
            ].join(" ")}
          >
            {triggerLabel}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[var(--muted-foreground)]">
            {showClear ? (
              <span
                role="button"
                aria-label="Clear"
                tabIndex={-1}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onChange(null);
                }}
                className="rounded p-0.5 hover:bg-[var(--muted)]"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : null}
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className={[
            "z-50 w-[--radix-popover-trigger-width] min-w-[240px]",
            "overflow-hidden rounded-md border bg-[var(--card)] shadow-lg",
            "text-[var(--foreground)]",
          ].join(" ")}
          onOpenAutoFocus={(event) => {
            // Let the cmdk input take focus, not the first menu item.
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Command
            label={ariaLabel ?? placeholder}
            filter={(value, search) => {
              // `value` is the cmdk item key which we compose as
              // `${group}␟${label}␟${hint}␟${id}` below. Split and match any.
              const haystack = value.toLowerCase();
              return haystack.includes(search.trim().toLowerCase()) ? 1 : 0;
            }}
          >
            <div
              className={[
                "flex items-center gap-2 border-b px-2 py-1.5",
                "text-[var(--muted-foreground)]",
              ].join(" ")}
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              <Command.Input
                ref={inputRef}
                value={query}
                onValueChange={setQuery}
                placeholder={searchPlaceholder}
                className={[
                  "w-full bg-transparent text-sm outline-none",
                  "text-[var(--foreground)]",
                  "placeholder:text-[var(--muted-foreground)]",
                ].join(" ")}
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="rounded p-0.5 hover:bg-[var(--muted)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <Command.List
              className="max-h-[min(60vh,420px)] overflow-y-auto p-1"
              data-testid="searchable-select-list"
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--muted-foreground)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading…
                </div>
              ) : null}

              <Command.Empty className="py-6 text-center text-sm text-[var(--muted-foreground)]">
                {emptyText}
              </Command.Empty>

              {grouped.map(({ group, items: bucket }) => {
                const children = bucket.map((item) => {
                  const composedValue = [
                    item.group ?? "",
                    item.label,
                    item.hint ?? "",
                    item.id,
                  ].join("\u241f"); // ␟ — unit separator
                  const isSelected = item.id === value;
                  return (
                    <Command.Item
                      key={item.id}
                      value={composedValue}
                      disabled={item.disabled}
                      onSelect={() => {
                        capture("searchable_select_selected", {
                          surface: ariaLabel ?? placeholder,
                          item_count: items.length,
                          search_length: query.length,
                        });
                        onChange(item.id);
                        setOpen(false);
                      }}
                      data-testid="searchable-select-item"
                      data-id={item.id}
                      className={[
                        "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                        "data-[selected=true]:bg-[var(--accent)]",
                        "data-[disabled=true]:cursor-not-allowed",
                        "data-[disabled=true]:opacity-50",
                      ].join(" ")}
                    >
                      <Check
                        className={[
                          "h-3.5 w-3.5 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        ].join(" ")}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.hint ? (
                        <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                          {item.hint}
                        </span>
                      ) : null}
                    </Command.Item>
                  );
                });

                if (group) {
                  return (
                    <Command.Group
                      key={group}
                      heading={group}
                      className={[
                        "[&_[cmdk-group-heading]]:px-2",
                        "[&_[cmdk-group-heading]]:py-1",
                        "[&_[cmdk-group-heading]]:text-[10px]",
                        "[&_[cmdk-group-heading]]:font-medium",
                        "[&_[cmdk-group-heading]]:uppercase",
                        "[&_[cmdk-group-heading]]:tracking-wider",
                        "[&_[cmdk-group-heading]]:text-[var(--muted-foreground)]",
                      ].join(" ")}
                    >
                      {children}
                    </Command.Group>
                  );
                }
                return <div key="__ungrouped__">{children}</div>;
              })}
            </Command.List>

            {items.length > 0 ? (
              <div className="border-t px-2 py-1 text-[10px] text-[var(--muted-foreground)]">
                {items.length} item{items.length === 1 ? "" : "s"}
              </div>
            ) : null}
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
