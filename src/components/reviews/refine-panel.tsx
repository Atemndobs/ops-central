"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Loader2, Sparkles } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import type { ReviewProvider } from "@convex/lib/reviewResponseDraft";

const PROVIDERS: { value: ReviewProvider; label: string; color: string }[] = [
  { value: "gemini", label: "Gemini", color: "border-blue-400 text-blue-700 bg-blue-50" },
  { value: "claude", label: "Claude", color: "border-amber-400 text-amber-700 bg-amber-50" },
  { value: "openai", label: "OpenAI", color: "border-emerald-400 text-emerald-700 bg-emerald-50" },
];

function RefineSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label className="text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
        {label}
      </label>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="inline-flex w-full items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-left text-xs text-[var(--foreground)] hover:bg-[var(--accent)]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <span className="truncate">{selected?.label ?? "Select…"}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={4}
            className="z-50 min-w-[var(--radix-popover-trigger-width)] rounded-md border border-[var(--border)] bg-[var(--card)] shadow-md p-1"
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--accent)]/40 text-left"
              >
                <Check className={`h-3.5 w-3.5 shrink-0 ${option.value === value ? "opacity-100" : "opacity-0"}`} />
                {option.label}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

export type RefinePanelProps = {
  incentive: string;
  setIncentive: (value: string) => void;
  tone: string;
  setTone: (value: string) => void;
  length: string;
  setLength: (value: string) => void;
  provider: ReviewProvider;
  setProvider: (value: ReviewProvider) => void;
  refineInstruction: string;
  setRefineInstruction: (value: string) => void;
  refining: boolean;
  onRefine: () => void;
};

export function RefinePanel({
  incentive,
  setIncentive,
  tone,
  setTone,
  length,
  setLength,
  provider,
  setProvider,
  refineInstruction,
  setRefineInstruction,
  refining,
  onRefine,
}: RefinePanelProps) {
  return (
    <div className="rounded-xl border border-violet-200 bg-[var(--background)] p-3 space-y-3 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[110px]">
          <RefineSelect
            label="Length"
            value={length}
            onChange={setLength}
            options={[
              { value: "short", label: "Short (2–3 sentences)" },
              { value: "standard", label: "Standard (3–5 sentences)" },
              { value: "detailed", label: "Detailed (5+ sentences)" },
            ]}
          />
        </div>
        <div className="flex-1 min-w-[130px]">
          <RefineSelect
            label="Incentive"
            value={incentive}
            onChange={setIncentive}
            options={[
              { value: "none", label: "None" },
              { value: "return_discount", label: "10% return discount" },
              { value: "google_review", label: "Google review ask" },
              { value: "early_late_checkin", label: "Early/late check-in" },
            ]}
          />
        </div>
        <div className="flex-1 min-w-[110px]">
          <RefineSelect
            label="Tone"
            value={tone}
            onChange={setTone}
            options={[
              { value: "professional", label: "Professional" },
              { value: "warm and friendly", label: "Warm" },
              { value: "brief and concise", label: "Brief" },
              { value: "empathetic", label: "Empathetic" },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <label className="text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
            Provider
          </label>
          <div className="flex items-center gap-1.5">
            {PROVIDERS.map((providerOption) => (
              <button
                key={providerOption.value}
                type="button"
                onClick={() => setProvider(providerOption.value)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  provider === providerOption.value
                    ? providerOption.color
                    : "border-[var(--border)] hover:bg-[var(--muted)] text-[var(--foreground)]"
                }`}
              >
                {providerOption.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-1">
          Additional instruction (optional)
        </label>
        <input
          type="text"
          placeholder='e.g. "Mention the rooftop view specifically" or leave blank to use template blocks'
          value={refineInstruction}
          onChange={(event) => setRefineInstruction(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && !refining && onRefine()}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] px-2.5 py-1.5 text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-violet-400"
        />
      </div>

      <button
        type="button"
        onClick={onRefine}
        disabled={refining}
        className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
      >
        {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {refining ? "Refining…" : "Regenerate draft"}
      </button>
    </div>
  );
}
