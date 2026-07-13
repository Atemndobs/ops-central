# b2-cdn-worker

A **private, edge-cached Cloudflare Worker** that sits in front of the Backblaze
B2 `job-photos` bucket. It turns repeat photo/video views into Cloudflare
edge-cache hits so they stop counting against B2's daily download / Class-B caps
(Cloudflare↔B2 egress is free via the Bandwidth Alliance), while keeping the
bucket **private** — every request must carry a valid short-lived HMAC token
minted by the app.

```
cleaner phone ──► https://img.chezsoistays.com/<objectKey>?exp=…&sig=…
                        │  Worker verifies HMAC + expiry
                        │  edge-cache HIT ─────────────► served (never touches B2)
                        └─ MISS ─► SigV4 GET to private B2 ─► cache + serve
```

## How it fits the app

`convex/lib/externalStorage.ts` → `createExternalReadUrl` emits a signed CDN URL
for B2-backed objects **when `B2_CDN_BASE_URL` + `B2_CDN_SIGNING_SECRET` are set
on the Convex deployment** (otherwise it falls back to a direct B2 presigned
URL — today's behavior). The token scheme is byte-identical on both sides:

```
message = `${objectKey}\n${exp}`
sig     = base64url( HMAC-SHA256(secret, message) )   # no padding
url     = `${B2_CDN_BASE_URL}/${encodedObjectKey}?exp=${exp}&sig=${sig}`
```

`src/sign.test.js` pins that scheme (`node --test`).

## One-time setup

Prereqs: the `chezsoistays.com` zone is on Cloudflare; you have `wrangler`
(`npm i` here installs it) and a B2 app key **scoped read-only** to the bucket.

1. **DNS** — in Cloudflare, add a proxied (orange-cloud) record for the CDN host,
   e.g. `img.chezsoistays.com` (a CNAME to anything/`100::` is fine; the Worker
   route intercepts it).
2. **Route** — uncomment the `routes` block in `wrangler.toml` and set the zone.
3. **Config** — confirm `[vars]` in `wrangler.toml` match the B2 bucket
   (`B2_BUCKET`, `B2_S3_ENDPOINT`, `B2_REGION`).
4. **Secrets** — generate a signing secret and set all three:
   ```bash
   cd infra/b2-cdn-worker && npm install && wrangler login
   openssl rand -base64 32                 # -> use as CDN_SIGNING_SECRET
   wrangler secret put CDN_SIGNING_SECRET  # paste the value above
   wrangler secret put B2_KEY_ID           # B2 app key id (read-only to bucket)
   wrangler secret put B2_APPLICATION_KEY  # B2 app key
   ```
5. **Deploy** — `npm run deploy`.
6. **Wire the app** — set the matching env on the Convex **prod** deployment and
   redeploy the backend from the owner repo (`opscentral-admin`):
   ```bash
   cd ../../                                   # opscentral-admin root
   npx convex env set B2_CDN_BASE_URL https://img.chezsoistays.com
   npx convex env set B2_CDN_SIGNING_SECRET '<same value as CDN_SIGNING_SECRET>'
   CONVEX_DEPLOY_KEY=$PROD_CONVEX_DEPLOY_KEY npx convex deploy
   cd ../jna-cleaners-app && npm run sync:convex-backend
   ```
   From this point, B2 photo URLs are CDN URLs. MinIO (if ever enabled) is
   unaffected.

## Verify

```bash
# Should be 200 with X-Cache: MISS then HIT on a repeat; 403 for a bad/expired sig.
curl -sI "https://img.chezsoistays.com/<objectKey>?exp=9999999999&sig=deadbeef"   # 403
# (a real app URL will 200)
```

## Rollback

`npx convex env remove B2_CDN_BASE_URL` (or `B2_CDN_SIGNING_SECRET`) + redeploy
the Convex backend → URLs instantly revert to direct B2 presigning. The Worker
can be left deployed (harmless) or `wrangler delete`d.

## Notes / limits

- **Cache key is the object path only** (token stripped) so all users share one
  cache entry. Object keys are content-addressed (timestamped per job) → cached
  `immutable` for a year; a re-uploaded/renamed object gets a new key.
- **Videos**: streamed, not buffered — fine for large files.
- Only expose port-443 traffic here; do **not** point this at the B2 or MinIO
  admin surfaces.
