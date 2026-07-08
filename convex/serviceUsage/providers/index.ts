/**
 * Provider adapter registry.
 *
 * Add a new provider in three lines: import, register, done. The cron
 * action and the chatbot tool both consume this registry — no other
 * code change needed.
 */

import type { Adapter } from "./types";
import { fetchConvexQuotas } from "./convex";
import { fetchClerkQuotas } from "./clerk";
import { fetchB2Quotas } from "./b2";

export const ADAPTERS: Record<string, Adapter> = {
  convex: fetchConvexQuotas,
  clerk: fetchClerkQuotas,
  b2: fetchB2Quotas,
};

export type ProviderKey = keyof typeof ADAPTERS;

export function getAdapter(serviceKey: string): Adapter | undefined {
  return ADAPTERS[serviceKey as ProviderKey];
}
