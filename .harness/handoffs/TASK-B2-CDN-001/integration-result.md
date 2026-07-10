# Integration Result

## Task
TASK-B2-CDN-001

## Merged at
2026-07-10 (PR #208)

## Merge sha
0bdc992

## Tests run
- npx convex deploy → lovable-oriole-182: pass (✔ no indexes deleted, schema validation complete)
- No `_generated` drift (no new Convex functions) — nothing to commit
- Regression check: B2 photo presigned GET → 200 (B2_CDN_* unset ⇒ inert, unchanged behavior)
- node --test infra/b2-cdn-worker/src/sign.test.js → 3/3 (pre-merge)

## Convex
- Deployed: yes → lovable-oriole-182 (behavior-neutral; CDN path dormant until env set)
- Mirrored to cleaners: `npm run sync:convex-backend` ✓

## Issues found
- None.

## Status
integrated (inert)

## Enablement (operator, pending — needs Cloudflare account)
1. Deploy the Worker: `cd infra/b2-cdn-worker && npm i && wrangler login`, set `img.chezsoistays.com`
   DNS (proxied), `wrangler secret put CDN_SIGNING_SECRET|B2_KEY_ID|B2_APPLICATION_KEY`, `npm run deploy`.
2. Then (main session can do): `npx convex env set B2_CDN_BASE_URL https://img.chezsoistays.com`
   + `B2_CDN_SIGNING_SECRET <same as worker>`, `npx convex deploy`, mirror cleaners.
3. Verify a real photo loads through the CDN (X-Cache MISS→HIT).
