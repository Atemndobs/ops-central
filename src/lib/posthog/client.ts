import posthog, { type PostHog } from "posthog-js";

// Env var names mirror the archived jna-bs-admin so existing PostHog keys
// port over without renaming. Optional fallback to the shorter names.
const KEY =
  process.env.NEXT_PUBLIC_POSTHOG_API_KEY ??
  process.env.NEXT_PUBLIC_POSTHOG_KEY ??
  "";

const HOST =
  process.env.NEXT_PUBLIC_POSTHOG_API_HOST ??
  process.env.NEXT_PUBLIC_POSTHOG_HOST ??
  "https://us.i.posthog.com";

let client: PostHog | null = null;

export function getPostHog(): PostHog | null {
  if (typeof window === "undefined") return null;
  return client;
}

export function initPostHog(): PostHog | null {
  if (typeof window === "undefined") return null;
  if (!KEY) return null;
  if (client) return client;

  posthog.init(KEY, {
    api_host: HOST,
    capture_pageview: false, // we handle pageviews via the provider
    capture_pageleave: true,
    person_profiles: "identified_only",
    loaded: (ph) => {
      if (process.env.NODE_ENV === "development") ph.debug(false);
    },
  });

  client = posthog;
  return client;
}

export function capture(
  event: string,
  properties?: Record<string, unknown>,
): void {
  const ph = getPostHog();
  if (!ph) return;
  ph.capture(event, properties);
}

export function identify(
  distinctId: string,
  props?: Record<string, unknown>,
): void {
  const ph = getPostHog();
  if (!ph) return;
  ph.identify(distinctId, props);
}

export function resetPostHog(): void {
  const ph = getPostHog();
  if (!ph) return;
  ph.reset();
}
