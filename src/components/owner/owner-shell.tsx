"use client";

import Link from "next/link";
import Image from "next/image";
import { UserButton } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Home, CalendarDays, Settings as SettingsIcon } from "lucide-react";
import { CleanerIconButton } from "@/components/cleaner/cleaner-ui";
import { InstallPrompt } from "@/components/cleaner/install-prompt";
import { OwnerBackButton } from "./back-button";

const OWNER_NAV: Array<{
  href: string;
  label: string;
  icon: typeof Home;
  matchPrefixes: string[];
}> = [
  {
    href: "/owner",
    label: "Home",
    icon: Home,
    // /owner is the property-list home; /owner/properties/:id drills in.
    // Both share the Home tab — there is no standalone /owner/properties index.
    matchPrefixes: ["/owner", "/owner/properties"],
  },
  {
    href: "/owner/blocks",
    label: "Blocks",
    icon: CalendarDays,
    matchPrefixes: ["/owner/blocks"],
  },
  {
    href: "/owner/settings",
    label: "Settings",
    icon: SettingsIcon,
    matchPrefixes: ["/owner/settings"],
  },
];

function matchLength(prefixes: string[], pathname: string): number {
  let best = 0;
  for (const prefix of prefixes) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      if (prefix.length > best) best = prefix.length;
    }
  }
  return best;
}

function isOwnerNavActive(itemHref: string, pathname: string): boolean {
  let winnerHref: string | null = null;
  let winnerLength = 0;
  for (const candidate of OWNER_NAV) {
    const length = matchLength(candidate.matchPrefixes, pathname);
    if (length > winnerLength) {
      winnerLength = length;
      winnerHref = candidate.href;
    }
  }
  return winnerHref === itemHref;
}

/**
 * Owner-portal shell. Consumes design-system tokens (cleaner palette) so the
 * owner surface stays cohesive with the rest of the ChezSoiStays brand
 * (cleaner PWA, mobile app). All colors via `--cleaner-*` CSS vars from
 * design-system/tokens/colors.ts.
 */
export function OwnerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
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
        <div className="mt-2 md:hidden">
          <InstallPrompt />
        </div>
      </div>
      <main className="mx-auto max-w-5xl px-6 pb-32 pt-4 md:pb-8">{children}</main>
      <footer
        className="mx-auto max-w-5xl px-6 py-8 text-center text-xs"
        style={{ color: "var(--cleaner-muted)" }}
      >
        ChezSoiStays — every line on this statement is a clickable receipt.
      </footer>

      {/* Mobile bottom nav — mirrors the cleaner PWA pattern so the owner
          PWA on mobile gets native-app-style tabs instead of leaning on the
          browser back button. Hidden on md+ where desktop chrome (header
          links) is enough. */}
      <nav
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 bg-transparent md:hidden"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6px)" }}
        aria-label="Owner navigation"
      >
        <ul className="pointer-events-auto mx-auto grid max-w-[402px] grid-cols-3 items-center justify-items-center gap-x-3 px-12 pb-2">
          {OWNER_NAV.map((item) => {
            const isActive = isOwnerNavActive(item.href, pathname);
            return (
              <li key={item.href} className="list-none">
                <Link href={item.href} aria-label={item.label} title={item.label} className="block">
                  <CleanerIconButton
                    icon={item.icon}
                    label={item.label}
                    active={isActive}
                    size="nav"
                    className="shadow-[0px_2px_8.2px_rgba(0,0,0,0.18)]"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
