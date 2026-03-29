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

Shared deployment:
- URL: `https://usable-anaconda-394.eu-west-1.convex.cloud`
- Deployment: `dev:usable-anaconda-394`
