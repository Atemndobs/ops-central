"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Building2 } from "lucide-react";
import type { ReactNode } from "react";

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
          <Link href="/owner" className="flex items-center gap-2.5 tracking-tight">
            <Building2 size={20} style={{ color: "var(--cleaner-primary)" }} />
            <span className="flex items-baseline gap-2">
              <span
                className="text-xl"
                style={{
                  fontFamily: "var(--font-cleaner-display), serif",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                }}
              >
                ChezSoiStays
              </span>
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
            </span>
          </Link>
          <UserButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      <footer
        className="mx-auto max-w-5xl px-6 py-8 text-center text-xs"
        style={{ color: "var(--cleaner-muted)" }}
      >
        ChezSoiStays — every line on this statement is a clickable receipt.
      </footer>
    </div>
  );
}
