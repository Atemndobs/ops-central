"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Back button rendered in the OwnerShell header. Hidden on `/owner`
 * (the root, nowhere to go back to). Everywhere else, derives its
 * parent route from `parentRouteFor()` so deep-links still work
 * (router.back() with empty history would be a no-op).
 *
 * Strategy:
 *   1. If browser history has > 1 entry → use router.back() (true SPA
 *      back, preserves scroll position, etc.)
 *   2. Else → router.push() to the registered parent route, carrying
 *      `?month=` through where the parent surface supports it.
 *
 * App-wide promotion: lift to /components/layout/ once the pattern
 * proves itself in the owner section.
 */
export function OwnerBackButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const parent = parentRouteFor(pathname);
  if (!parent) return null;
  // Hoist into a const so the closure type-narrows past the `!parent`
  // early-return without needing repeated `!` assertions.
  const parentRoute = parent;

  function handle() {
    const hasHistory =
      typeof window !== "undefined" && window.history.length > 1;
    if (hasHistory) {
      router.back();
    } else {
      // Carry `?month=` to the parent if it has one (so the dashboard
      // we land on stays in the same period context).
      const sp = new URLSearchParams();
      const m = params.get("month");
      if (m) sp.set("month", m);
      const qs = sp.toString();
      router.push(qs ? `${parentRoute.href}?${qs}` : parentRoute.href);
    }
  }

  return (
    <button
      onClick={handle}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-black/[0.04]"
      style={{ color: "var(--cleaner-muted)" }}
      aria-label={`Back to ${parentRoute.label}`}
    >
      <ArrowLeft size={14} />
      {parentRoute.label}
    </button>
  );
}

/**
 * Pathname → parent registry. Owner section only for now; same shape
 * promotes app-wide later.
 *
 * Pathname matching uses simple prefix/segment rules — the router gives
 * us the live pathname including dynamic segments resolved (e.g.
 * `/owner/properties/rs76.../statements/st42...`), so we match by
 * "depth" rather than reconstructing the route template.
 */
function parentRouteFor(
  pathname: string,
): { href: string; label: string } | null {
  if (pathname === "/owner") return null;

  // Statement / approval detail → property page
  const stmtMatch = pathname.match(/^(\/owner\/properties\/[^/]+)\/statements\/[^/]+$/);
  if (stmtMatch) return { href: stmtMatch[1], label: "Property" };
  const apprMatch = pathname.match(/^(\/owner\/properties\/[^/]+)\/approvals\/[^/]+$/);
  if (apprMatch) return { href: apprMatch[1], label: "Property" };

  // Property root → dashboard
  if (/^\/owner\/properties\/[^/]+$/.test(pathname)) {
    return { href: "/owner", label: "Dashboard" };
  }

  // /owner/blocks, /owner/settings, /owner/help → dashboard
  if (/^\/owner\/[^/]+$/.test(pathname)) {
    return { href: "/owner", label: "Dashboard" };
  }

  return { href: "/owner", label: "Dashboard" };
}
