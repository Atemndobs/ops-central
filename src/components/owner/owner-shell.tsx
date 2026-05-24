"use client";

import Link from "next/link";
import Image from "next/image";
import { UserButton } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { OwnerBackButton } from "./back-button";

/**
 * Owner-portal shell. Consumes design-system tokens (cleaner palette) so the
 * owner surface stays cohesive with the rest of the ChezSoiStays brand
 * (cleaner PWA, mobile app). All colors via `--cleaner-*` CSS vars from
 * design-system/tokens/colors.ts.
 */
export function OwnerShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen"
      style={{
        background: "var(--cleaner-bg)",
        color: "var(--cleaner-ink)",
        fontFamily: "var(--font-cleaner-body), system-ui, sans-serif",
      }}
    >
      <header
        className="sticky top-0 z-10 backdrop-blur"
        style={{
          background: "color-mix(in oklab, var(--cleaner-bg) 90%, transparent)",
          borderBottom: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          {/* Brand mark = ChezSoiStays app logo (same asset the cleaner PWA
              uses). Wordmark dropped — the logo IS the brand mark.
              Tapping anywhere on the logo navigates back to /owner. */}
          <Link
            href="/owner"
            className="flex items-center gap-2.5"
            aria-label="ChezSoiStays — Owner home"
          >
            <Image
              src="/icons/chezsoi-icon-192.png"
              alt="ChezSoiStays"
              width={32}
              height={32}
              priority
              className="rounded-md"
            />
            <span
              className="text-[10px]"
              style={{
                fontFamily: "var(--font-cleaner-mono), monospace",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--cleaner-muted)",
              }}
            >
              Owner
            </span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link
              href="/owner/settings"
              className="hover:underline"
              style={{ color: "var(--cleaner-muted)" }}
            >
              Settings
            </Link>
            <UserButton />
          </div>
        </div>
      </header>
      {/* Back-navigation bar — empty on /owner root, renders ← parent
          everywhere else. Outside the main padding so the back affordance
          feels structural (always-on top-left chrome), not content. */}
      <div className="mx-auto max-w-5xl px-6 pt-4">
        <OwnerBackButton />
      </div>
      <main className="mx-auto max-w-5xl px-6 pb-8 pt-4">{children}</main>
      <footer
        className="mx-auto max-w-5xl px-6 py-8 text-center text-xs"
        style={{ color: "var(--cleaner-muted)" }}
      >
        ChezSoiStays — every line on this statement is a clickable receipt.
      </footer>
    </div>
  );
}
