"use client";

import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

interface FilterDropdownProps {
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function FilterDropdown({ options, value, onChange, placeholder = "All" }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const label = selected
    ? selected.count !== undefined
      ? `${selected.label} (${selected.count})`
      : selected.label
    : placeholder;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors min-w-0 max-w-[200px]"
        >
          <span className="truncate flex-1 text-left">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          className="z-50 min-w-[180px] max-w-[260px] rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg py-1 outline-none"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => { onChange(option.value); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-[var(--muted)] ${
                  isSelected ? "text-[var(--foreground)] font-medium" : "text-[var(--foreground)]"
                }`}
              >
                <Check className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "opacity-100" : "opacity-0"}`} />
                <span className="truncate flex-1">
                  {option.label}
                  {option.count !== undefined && (
                    <span className="ml-1 text-[var(--muted-foreground)] font-normal">({option.count})</span>
                  )}
                </span>
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
