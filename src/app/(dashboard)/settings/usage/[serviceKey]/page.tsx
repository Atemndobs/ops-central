import { notFound } from "next/navigation";
import {
  ServiceDetailClient,
  type ServiceKey,
} from "@/components/settings/usage/service-detail-client";

const VALID_SERVICE_KEYS: readonly ServiceKey[] = [
  "gemini",
  "clerk",
  "hospitable",
  "resend",
  "convex",
] as const;

function parseServiceKey(raw: string): ServiceKey | null {
  return VALID_SERVICE_KEYS.includes(raw as ServiceKey)
    ? (raw as ServiceKey)
    : null;
}

/**
 * /settings/usage/[serviceKey] — per-service usage detail. Admin-only via
 * parent route gating; the underlying Convex query also enforces
 * `requireAdmin`.
 */
export default async function UsageDetailPage({
  params,
}: {
  params: Promise<{ serviceKey: string }>;
}) {
  const { serviceKey: raw } = await params;
  const serviceKey = parseServiceKey(raw);
  if (!serviceKey) {
    notFound();
  }

  return <ServiceDetailClient serviceKey={serviceKey} />;
}
