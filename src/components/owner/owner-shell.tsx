"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Building2 } from "lucide-react";
import type { ReactNode } from "react";

// Link is used by the home wordmark below; settings/help links land in a Wave 4b PR.

/**
 * Owner-portal shell. Light, calm, money-focused. Single top nav with the
 * ChezSoiStays wordmark + user menu. The product is the content, not the chrome.
 */
export function OwnerShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#fafaf7] text-[#1a1a1a]">
      <header className="sticky top-0 z-10 border-b border-[#e8e6e0] bg-[#fafaf7]/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/owner" className="group flex items-center gap-2.5 font-semibold tracking-tight">
            <Building2 size={20} className="text-[#1a237e]" />
            <span className="flex items-baseline gap-2">
              <span className="text-lg">ChezSoiStays</span>
              <span className="text-xs font-normal uppercase tracking-wider text-[#999]">
                Owner
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <UserButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      <footer className="mx-auto max-w-5xl px-6 py-8 text-center text-xs text-[#999]">
        ChezSoiStays — every line on this statement is a clickable receipt.
      </footer>
    </div>
  );
}
