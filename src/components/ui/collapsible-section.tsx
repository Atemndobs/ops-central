"use client";

/**
 * CollapsibleSection — a lightweight accordion row for settings pages.
 *
 * Fits the "fold a long setting into a titled row, click to unfold"
 * pattern. Stores open state in-component by default; pass
 * `persistKey` to remember it in localStorage across reloads.
 *
 * Looks: matches the existing card visual (`bg-[var(--card)]` border)
 * so sections drop into place without theme work.
 *
 * Accessibility: the expand/collapse control is a real `<button>` with
 * `aria-expanded`, and the body lives in a region controlled by
 * `aria-controls` /`id`. The optional `badge` is rendered as a sibling of
 * the button (NOT inside it) so callers can place interactive elements
 * like toggles in that slot without producing invalid nested buttons.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface CollapsibleSectionProps {
  /** Required short title shown in the always-visible header. */
  title: string;
  /** Optional one-line helper text shown under the title. */
  subtitle?: string;
  /** Optional chip or status element shown on the right of the header. */
  badge?: ReactNode;
  /** Optional icon rendered before the title. */
  icon?: ReactNode;
  /** Whether the section starts open. Ignored if `persistKey` has a value in localStorage. */
  defaultOpen?: boolean;
  /** Persist the open/closed state under `settings-collapse-${persistKey}`. */
  persistKey?: string;
  /** Extra class names on the outer wrapper. */
  className?: string;
  /** Folded content. Rendered lazily on first open so expensive children
   *  (queries, charts) aren't paid for until needed. */
  children: ReactNode;
}

function readStoredOpen(key: string | undefined, fallback: boolean): boolean {
  if (!key || typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(`settings-collapse-${key}`);
    if (raw === "open") return true;
    if (raw === "closed") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function writeStoredOpen(key: string | undefined, open: boolean): void {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `settings-collapse-${key}`,
      open ? "open" : "closed",
    );
  } catch {
    // ignore quota / privacy errors
  }
}

export function CollapsibleSection({
  title,
  subtitle,
  badge,
  icon,
  defaultOpen = false,
  persistKey,
  className,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState<boolean>(() =>
    readStoredOpen(persistKey, defaultOpen),
  );
  const [everOpened, setEverOpened] = useState<boolean>(() =>
    readStoredOpen(persistKey, defaultOpen),
  );

  useEffect(() => {
    writeStoredOpen(persistKey, open);
  }, [open, persistKey]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) setEverOpened(true);
      return next;
    });
  }, []);

  const bodyId =
    persistKey ??
    `collapsible-${title.replaceAll(/\s+/g, "-").toLowerCase()}`;

  return (
    <section
      className={`rounded-lg border border-[var(--border)] bg-[var(--card)] ${
        className ?? ""
      }`}
    >
      {/* Header row: the expand/collapse <button> + the badge slot live
          side-by-side, NOT nested — so callers can put interactive
          elements (toggles, links) in `badge` without producing invalid
          nested <button> HTML. */}
      <div className="flex w-full items-stretch gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex flex-1 items-center gap-3 rounded-lg px-5 py-4 text-left transition hover:bg-[var(--accent)]/40"
        >
          {icon ? (
            <span className="shrink-0 text-[var(--primary)]">{icon}</span>
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-[var(--foreground)]">
              {title}
            </span>
            {subtitle ? (
              <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                {subtitle}
              </span>
            ) : null}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
        {badge ? (
          <div className="flex shrink-0 items-center pr-5">{badge}</div>
        ) : null}
      </div>
      {everOpened ? (
        <div
          id={bodyId}
          hidden={!open}
          className="border-t border-[var(--border)] px-5 py-4"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}
