/**
 * b2-cdn-worker — private, edge-cached CDN in front of a Backblaze B2 bucket.
 *
 * The OpsCentral/cleaners backend hands photo/video URLs of the form
 *   https://<cdn-host>/<objectKey>?exp=<unix>&sig=<hmac>
 * (see `convex/lib/externalStorage.ts` → `signCdnReadUrl`). This Worker:
 *   1. verifies the HMAC token (shared `CDN_SIGNING_SECRET`) + expiry,
 *   2. serves from Cloudflare's edge cache keyed by object path (so every
 *      user's differently-signed URL for the same object shares one entry),
 *   3. on a cache miss, fetches the PRIVATE object from B2 with a SigV4-signed
 *      GET (B2 key lives only in Worker secrets — the bucket stays private),
 *   4. caches it immutably (object keys are content-addressed → never change).
 *
 * Net effect: repeat photo views are edge-cache hits and never touch B2, so
 * they stop counting against B2's download/transaction caps. Cloudflare↔B2
 * egress is free via the Bandwidth Alliance.
 *
 * The HMAC scheme (message `${objectKey}\n${exp}`, HMAC-SHA256, base64url no
 * padding) MUST stay byte-identical to `signCdnReadUrl` in the Convex backend.
 */

import { AwsClient } from "aws4fetch";

export interface Env {
  /** HMAC secret shared with the Convex backend's B2_CDN_SIGNING_SECRET. */
  CDN_SIGNING_SECRET: string;
  /** B2 application key id + key (secrets). */
  B2_KEY_ID: string;
  B2_APPLICATION_KEY: string;
  /** e.g. https://s3.us-east-005.backblazeb2.com */
  B2_S3_ENDPOINT: string;
  B2_BUCKET: string;
  /** e.g. us-east-005 */
  B2_REGION: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacBase64Url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return toBase64Url(new Uint8Array(mac));
}

/** Constant-time string compare to avoid signature timing oracles. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function encodePath(objectKey: string): string {
  return objectKey.split("/").map(encodeURIComponent).join("/");
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(req.url);
    const objectKey = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const exp = Number(url.searchParams.get("exp") ?? "0");
    const sig = url.searchParams.get("sig") ?? "";

    if (!objectKey || !Number.isFinite(exp) || exp <= 0 || !sig) {
      return new Response("Bad Request", { status: 400 });
    }
    if (Math.floor(Date.now() / 1000) > exp) {
      return new Response("Link expired", { status: 403 });
    }

    const expected = await hmacBase64Url(
      env.CDN_SIGNING_SECRET,
      `${objectKey}\n${exp}`,
    );
    if (!timingSafeEqual(expected, sig)) {
      return new Response("Forbidden", { status: 403 });
    }

    // Edge cache keyed by object path only (token stripped) so all users share it.
    const cache = caches.default;
    const cacheKey = new Request(`${url.origin}/${encodePath(objectKey)}`, {
      method: "GET",
    });
    const hit = await cache.match(cacheKey);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set("X-Cache", "HIT");
      return new Response(hit.body, { status: hit.status, headers });
    }

    // Cache miss → SigV4-signed GET against the private B2 object.
    const aws = new AwsClient({
      accessKeyId: env.B2_KEY_ID,
      secretAccessKey: env.B2_APPLICATION_KEY,
      region: env.B2_REGION,
      service: "s3",
    });
    const endpoint = env.B2_S3_ENDPOINT.replace(/\/+$/, "");
    const originUrl = `${endpoint}/${env.B2_BUCKET}/${encodePath(objectKey)}`;
    const signed = await aws.sign(originUrl, { method: "GET" });
    const origin = await fetch(signed);

    if (!origin.ok) {
      return new Response(origin.status === 404 ? "Not found" : "Upstream error", {
        status: origin.status === 404 ? 404 : 502,
      });
    }

    const headers = new Headers(origin.headers);
    // Content-addressed keys never change → cache a year, immutable.
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("X-Cache", "MISS");
    headers.delete("set-cookie");
    for (const h of ["x-bz-file-id", "x-bz-file-name", "x-bz-upload-timestamp"]) {
      headers.delete(h);
    }

    // Stream to the client and tee a copy into the edge cache (no full buffer).
    const resp = new Response(origin.body, { status: 200, headers });
    ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  },
};
