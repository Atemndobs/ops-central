"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";

import {
  capture,
  getPostHog,
  identify,
  initPostHog,
  resetPostHog,
} from "@/lib/posthog/client";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isSignedIn, userId } = useAuth();
  const { user } = useUser();
  const lastIdentifiedId = useRef<string | null>(null);

  // Init on mount (guard keeps it idempotent).
  useEffect(() => {
    initPostHog();
  }, []);

  // Identify / reset when Clerk auth state changes.
  useEffect(() => {
    if (!getPostHog()) return;
    if (isSignedIn && userId && userId !== lastIdentifiedId.current) {
      identify(userId, {
        email: user?.primaryEmailAddress?.emailAddress ?? undefined,
        name: user?.fullName ?? undefined,
      });
      lastIdentifiedId.current = userId;
    } else if (!isSignedIn && lastIdentifiedId.current) {
      resetPostHog();
      lastIdentifiedId.current = null;
    }
  }, [isSignedIn, userId, user]);

  // Track pageviews on route changes.
  useEffect(() => {
    if (!pathname) return;
    if (!getPostHog()) return;
    const url =
      pathname +
      (searchParams && searchParams.toString()
        ? `?${searchParams.toString()}`
        : "");
    capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return <>{children}</>;
}
