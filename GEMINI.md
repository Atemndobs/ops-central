# OpsCentral Admin Context

## 🚨 BIG FAT WARNING: VERY DANGEROUS CONVEX DEPLOYMENT RULE

- `opscentral-admin` is the only Convex backend owner repo.
- Never run Convex deploy/dev/codegen from `jna-cleaners-app`.
- Wrong-folder deployment can overwrite shared functions for both apps.

Owner command path:
```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin
npx convex <command>
```

After backend changes, mirror backend into cleaners repo:
```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/jna-cleaners-app
npm run sync:convex-backend
```

Shared deployment (prod, US region — migrated 2026-05-02 from the
retired EU dev DB `usable-anaconda-394`):
- URL: `https://lovable-oriole-182.convex.cloud`
- Deployment: `prod:lovable-oriole-182`
- Ship via `npx convex deploy` with `PROD_CONVEX_DEPLOY_KEY` from
  `.env.local` (Node 20+ required).
