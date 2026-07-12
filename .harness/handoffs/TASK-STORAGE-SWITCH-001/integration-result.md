# Integration Result

## Task
TASK-STORAGE-SWITCH-001

## Merged at
2026-07-10 18:44 UTC

## Merge sha
3bbc88e (merge) — feature 910550f; post-deploy bindings d8ab304

## Tests run
- npx convex deploy → lovable-oriole-182: pass (✔ no indexes deleted, schema validation complete)
- npm run build: pass (all routes incl. /settings compiled against regenerated types)
- Manual: presigned MinIO GET through Tailscale Funnel verified 200 off-tailnet (see below)

## Convex
- Deployed: yes → lovable-oriole-182
- Command: `CONVEX_DEPLOY_KEY=$PROD_CONVEX_DEPLOY_KEY npx convex deploy`
- Regenerated `convex/_generated/api.d.ts` committed to main (d8ab304)
- Mirrored to cleaners: `npm run sync:convex-backend` ✓

## Issues found
- None blocking. Order matters: deploy (codegen) BEFORE build, since the frontend references
  the new `api.appSettings.*` fns — handled.

## Status
integrated

## Notes / follow-ups
- Feature ships INERT: active provider defaults to b2; `setStorageProvider` refuses MinIO
  while `MINIO_*` is unset in Convex prod (it currently is unset).
- To actually enable MinIO serving: create a scoped MinIO key + `job-photos` bucket, set
  `MINIO_ENDPOINT=https://minio.goose-neon.ts.net` + `MINIO_BUCKET`/`MINIO_REGION`/keys in
  Convex prod, then flip the switch. Funnel path verified working (200 off-tailnet).
- Existing broken B2 thumbnails are NOT fixed by this (they live in B2) — raise the B2 cap
  or add a CDN in front of B2 for history.
