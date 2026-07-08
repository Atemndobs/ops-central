/**
 * Backblaze B2 adapter.
 *
 * B2 is pay-as-you-go — no hard quota. We render against a configured
 * monthly USD budget cap (`B2_MONTHLY_BUDGET_USD`), so the bar fills
 * against "how close are we to my self-imposed spend ceiling" rather
 * than a platform limit. Same alerting purpose.
 *
 * Auth: keyId + applicationKey via `B2_APPLICATION_KEY_ID` and
 *       `B2_APPLICATION_KEY` (already present for photo storage).
 *
 * v1 returns one snapshot for total bytes stored across all buckets.
 * Cost projection (storage GB × $0.005) is folded into the same row's
 * `used` field if the budget cap is configured.
 */

import type { QuotaSnapshot } from "./types";

type AuthorizeResp = {
  apiUrl: string;
  authorizationToken: string;
  accountId: string;
  apiInfo?: {
    storageApi?: {
      apiUrl?: string;
    };
  };
};

type ListBucketsResp = {
  buckets: Array<{
    bucketId: string;
    bucketName: string;
    bucketType: string;
  }>;
};

const B2_AUTH_URL =
  "https://api.backblazeb2.com/b2api/v3/b2_authorize_account";

// Backblaze B2 storage pricing (Hot Storage tier), as of 2026.
// Update if pricing changes. Used to project monthly USD spend from
// the current stored-bytes count.
const PRICE_PER_GB_PER_MONTH_USD = 0.006;

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

async function authorize(): Promise<AuthorizeResp> {
  // Support both naming conventions: the existing photo-storage code uses
  // B2_KEY_ID / B2_APPLICATION_KEY, while Backblaze docs use the longer
  // B2_APPLICATION_KEY_ID. Accept either.
  const keyId =
    process.env.B2_KEY_ID ?? process.env.B2_APPLICATION_KEY_ID;
  const key = process.env.B2_APPLICATION_KEY;
  if (!keyId || !key) {
    throw new Error("B2_KEY_ID (or B2_APPLICATION_KEY_ID) / B2_APPLICATION_KEY not set");
  }

  const basic = Buffer.from(`${keyId}:${key}`).toString("base64");
  const res = await fetch(B2_AUTH_URL, {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`B2 authorize ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as AuthorizeResp;
}

async function listBuckets(
  apiUrl: string,
  token: string,
  accountId: string,
): Promise<ListBucketsResp["buckets"]> {
  const res = await fetch(`${apiUrl}/b2api/v3/b2_list_buckets`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`B2 list_buckets ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as ListBucketsResp;
  return data.buckets ?? [];
}

/**
 * Best-effort byte count per bucket via b2_list_file_versions paged scan.
 * We cap at MAX_FILES_PER_BUCKET to bound cost; if hit, the count is a
 * lower bound and we annotate the limit fallback path.
 *
 * NOTE: For a polished v2, switch to the B2 Cloud Storage Reports API
 * when available — it returns aggregate bucket sizes without paging.
 */
async function bucketBytes(
  apiUrl: string,
  token: string,
  bucketId: string,
): Promise<number> {
  const MAX_FILES = 10_000;
  let total = 0;
  let count = 0;
  let startFileName: string | undefined = undefined;
  let startFileId: string | undefined = undefined;

  while (count < MAX_FILES) {
    const body: Record<string, unknown> = {
      bucketId,
      maxFileCount: 1000,
    };
    if (startFileName) body.startFileName = startFileName;
    if (startFileId) body.startFileId = startFileId;

    const res = await fetch(`${apiUrl}/b2api/v3/b2_list_file_versions`, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`B2 list_file_versions ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      files: Array<{ contentLength: number }>;
      nextFileName?: string | null;
      nextFileId?: string | null;
    };
    for (const f of data.files ?? []) {
      total += f.contentLength ?? 0;
      count += 1;
    }
    if (!data.nextFileName) break;
    startFileName = data.nextFileName ?? undefined;
    startFileId = data.nextFileId ?? undefined;
  }

  return total;
}

export async function fetchB2Quotas(): Promise<QuotaSnapshot[]> {
  const auth = await authorize();
  const apiUrl =
    auth.apiInfo?.storageApi?.apiUrl ?? auth.apiUrl;
  const buckets = await listBuckets(apiUrl, auth.authorizationToken, auth.accountId);

  let totalBytes = 0;
  for (const b of buckets) {
    totalBytes += await bucketBytes(apiUrl, auth.authorizationToken, b.bucketId);
  }

  const fetchedAt = Date.now();
  const snapshots: QuotaSnapshot[] = [];

  // Storage bytes — if no budget cap, treat 1TB as the soft ceiling so
  // the bar still renders something sensible.
  const storageCeilingBytes = 1024 ** 4; // 1 TiB
  snapshots.push({
    serviceKey: "b2",
    quotaKey: "storage_bytes",
    used: totalBytes,
    limit: storageCeilingBytes,
    unit: "bytes",
    windowStart: fetchedAt - MONTH_MS,
    windowEnd: fetchedAt,
    fetchedAt,
  });

  // Monthly cost projection vs configured budget.
  const budgetUsd = Number(process.env.B2_MONTHLY_BUDGET_USD ?? "0");
  if (budgetUsd > 0) {
    const projectedUsd =
      (totalBytes / 1024 ** 3) * PRICE_PER_GB_PER_MONTH_USD;
    snapshots.push({
      serviceKey: "b2",
      quotaKey: "projected_monthly_spend",
      used: Math.round(projectedUsd * 100) / 100,
      limit: budgetUsd,
      unit: "usd",
      windowStart: fetchedAt - MONTH_MS,
      windowEnd: fetchedAt,
      fetchedAt,
    });
  }

  return snapshots;
}
