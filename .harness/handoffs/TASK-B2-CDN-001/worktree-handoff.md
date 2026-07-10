# Worktree Handoff

## Task
TASK-B2-CDN-001

## Type
implementation

## Branch
task/b2-cloudflare-cdn

## Worktree
~/sites/opscentral-admin-b2-cdn

## Base
origin/main @ 1275f42

## Status
ready-for-integration

## What changed
Private, edge-cached Cloudflare CDN in front of the B2 `job-photos` bucket, plus the backend
wiring to use it. **Inert until `B2_CDN_BASE_URL` + `B2_CDN_SIGNING_SECRET` are set** on Convex
prod — otherwise B2 read URLs are direct presigned URLs exactly as today.

- `convex/lib/externalStorage.ts` — `CdnConfig` + `getCdnConfigOrNull()` + `signCdnReadUrl()`
  (HMAC-SHA256 over `${objectKey}\n${exp}`, base64url no padding, via WebCrypto); CDN fast-path
  in `createExternalReadUrl` for `provider === "b2"`. MinIO unaffected.
- `infra/b2-cdn-worker/` — Cloudflare Worker (`src/worker.ts`) verifying the token, edge-caching
  by object path, SigV4-fetching the private object from B2 (`aws4fetch`) on miss; `wrangler.toml`,
  `tsconfig.json`, `package.json`, `.gitignore`, `README.md` (full setup + rollback).
- `infra/b2-cdn-worker/src/sign.test.js` — pins the shared token scheme (WebCrypto base64url ==
  canonical node base64url). 3/3 pass.
- `tsconfig.json` — added `infra` to root `exclude` (the Worker has its own tsconfig + deps).
- `Docs/2026-07-10-b2-cloudflare-cdn.md`.

## What main should test
1. `npx convex deploy` → lovable-oriole-182 (no schema change; inert), then `npm run build` (green).
2. `node --test infra/b2-cdn-worker/src/sign.test.js` → 3/3.
3. Confirm B2 photos still resolve unchanged (no `B2_CDN_*` env set ⇒ presigned as before).

## Schema impact
none.

## Convex impact
deploy-required, but **behavior-neutral** until `B2_CDN_*` env is set (dormant code path). No new
Convex functions ⇒ `_generated` unchanged; frontend build needs no codegen.

## Known risks
- None while inert. Once enabled: the Worker's `CDN_SIGNING_SECRET` and Convex
  `B2_CDN_SIGNING_SECRET` must be the SAME value, or all B2 photo URLs 403. Use a bucket-scoped
  read-only B2 key in the Worker, not the master key. Only the S3 endpoint (443) is fronted.

## Rollback plan
`git revert <sha>` + redeploy → back to direct presigning. Or, if enabled, just
`npx convex env remove B2_CDN_BASE_URL` + redeploy (instant revert; leave Worker deployed).

## Enablement (operator, out of PR scope)
Deploy Worker (`cd infra/b2-cdn-worker && npm i && wrangler login && wrangler secret put …
&& npm run deploy`), add DNS `img.chezsoistays.com`, set `B2_CDN_BASE_URL` +
`B2_CDN_SIGNING_SECRET` on Convex prod, redeploy backend, mirror cleaners. See the Worker README.

## Relationship to #207 (storage switch)
Independent + composable. #207 chooses B2 vs MinIO for new uploads; this changes how B2 read
URLs are formed. Both are inert-by-default.
