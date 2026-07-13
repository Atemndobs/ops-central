# Cloudflare CDN in front of Backblaze B2 (private, edge-cached)

**Task:** `task/b2-cloudflare-cdn` · **Date:** 2026-07-10 · **Schema impact:** none

## Why

Photos/videos serve from B2 via presigned S3 URLs; **every view is a Class-B
transaction + egress** billed against B2's daily cap. On 2026-07-10 that cap was
exceeded and all thumbnails 403'd. Raising the cap un-broke it, but the durable
fix is a CDN: repeat views become edge-cache hits that never touch B2, and
Cloudflare↔B2 egress is free (Bandwidth Alliance).

## What ships

Fully **inert until configured** — zero behavior change until the Cloudflare
Worker + env are set up.

1. **Worker** (`infra/b2-cdn-worker/`) — private, edge-cached proxy in front of
   the B2 bucket. Verifies a short-lived HMAC token, serves from
   `caches.default` keyed by object path, fetches the private object from B2 via
   SigV4 (`aws4fetch`) on a miss, caches it `immutable`. Setup in its README.
2. **Backend wiring** (`convex/lib/externalStorage.ts`) — `createExternalReadUrl`
   emits a signed CDN URL for **B2** objects when `B2_CDN_BASE_URL` +
   `B2_CDN_SIGNING_SECRET` are set; else falls back to direct B2 presigning.
   MinIO is unaffected.
3. **Parity test** (`infra/b2-cdn-worker/src/sign.test.js`) — pins the shared
   HMAC/base64url scheme so the Worker and Convex signers can't drift.

## Token scheme (identical both sides)

```
message = `${objectKey}\n${exp}`          # exp = unix seconds
sig     = base64url(HMAC-SHA256(secret, message))   # no padding
url     = `${B2_CDN_BASE_URL}/${encodedObjectKey}?exp=${exp}&sig=${sig}`
```

The Worker re-computes and constant-time-compares `sig`, rejects expired `exp`,
then serves. Cache key strips the token so all users share one edge entry.

## Privacy vs. cache

Chosen **private** (Worker-validates-token) over public-with-hotlink because
these are property/job photos. Caching still works because the cache key is the
object path (token-independent); auth is checked on every request before serving
from cache. The B2 bucket stays private — its key lives only in Worker secrets.

## Design decisions taken (defaults; revisit if needed)

- **Private, not public bucket.** Property photos.
- **CDN host** placeholder `img.chezsoistays.com` — change in `wrangler.toml` +
  `B2_CDN_BASE_URL` if you prefer another subdomain.
- **B2 key for the Worker** should be a **read-only key scoped to the bucket**,
  not the master key.

## Enable / rollback

Enable: deploy Worker → set `B2_CDN_BASE_URL` + `B2_CDN_SIGNING_SECRET` on Convex
prod → `npx convex deploy` → mirror cleaners. Rollback: remove either env +
redeploy → instant revert to direct B2 presigning. Full steps in the Worker
README.

## Relationship to the storage switch (PR #207)

Independent. The switch chooses B2 vs MinIO for **new uploads**; this CDN only
changes how **B2** read URLs are formed. They compose: a MinIO CDN could be
added later the same way.
