# Runbook — Hospitable Webhook URL-Token Auth (PR C)

**Date:** 2026-05-19
**Supersedes:** [hospitable-webhook-deploy.md](./hospitable-webhook-deploy.md) (HMAC-based, never deployed)
**Branch:** `task/hospitable-token-auth`

## Why this exists

The original webhook plan assumed Hospitable signs payloads with an HMAC secret. **It doesn't.** Verified against [Hospitable's official help doc](https://help.hospitable.com/en/articles/10008203-webhooks-for-reservations-properties-messages-and-reviews) and the Apps → Webhooks dashboard: the configuration form exposes only **name, URL, event types**. No signing key, no rotation UI, no `X-Hospitable-Signature` header on real traffic.

The drop-in replacement is **URL-token auth**: a 32-byte random token lives in the URL path. Only requests POSTed to `/api/webhooks/hospitable/<token>` are accepted; any other path returns 404 (deliberately not 401, so the endpoint's existence is unobservable).

Defense in depth: the Convex `ingestEvent` mutation still validates a second shared secret (`HOSPITABLE_WEBHOOK_SECRET`) between Next.js and Convex.

---

## 0. What changed in PR C

| Before (PR B, deployed) | After (PR C, this PR) |
|---|---|
| `POST /api/webhooks/hospitable` (no auth) | `POST /api/webhooks/hospitable/<token>` (URL-token auth) |
| Expected `X-Hospitable-Signature` header (didn't exist) | No signature expectation |
| HMAC-SHA256 plumbing | Dropped |
| 1 env var (`HOSPITABLE_WEBHOOK_SECRET`, never set) | 2 env vars: `HOSPITABLE_WEBHOOK_URL_TOKEN` + `HOSPITABLE_WEBHOOK_SECRET` |
| Header-snapshot logging for signature discovery | Header-snapshot logging for empirical no-signature confirmation (drop in follow-up) |

---

## 1. Generate secrets

```bash
node -e 'console.log("URL_TOKEN=" + require("crypto").randomBytes(32).toString("hex"))'
node -e 'console.log("INGEST_SECRET=" + require("crypto").randomBytes(32).toString("hex"))'
```

Save both values somewhere secure (1Password / Bitwarden) — you'll paste them into Vercel + Convex + the Hospitable dashboard.

## 2. Set env vars in Vercel (Production + Preview)

From the **main checkout** (not the PR worktree):

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin

# URL-path token
vercel env add HOSPITABLE_WEBHOOK_URL_TOKEN production
vercel env add HOSPITABLE_WEBHOOK_URL_TOKEN preview

# Next→Convex shared secret (defense in depth)
vercel env add HOSPITABLE_WEBHOOK_SECRET production
vercel env add HOSPITABLE_WEBHOOK_SECRET preview
```

Verify:

```bash
vercel env ls production | grep HOSPITABLE
```

## 3. Set the ingest secret in Convex (`lovable-oriole-182`)

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin
npx convex env set HOSPITABLE_WEBHOOK_SECRET <value-from-step-1>
# (no --prod flag needed; the deployment in CONVEX_DEPLOY_KEY is the target)
```

> The URL-path token is **only** in Vercel — Convex never sees it.

## 4. Merge PR C

```bash
gh pr merge <PR_NUMBER> --squash
```

Vercel auto-deploys main to prod (`app.chezsoistays.com`).

## 5. Smoke test the new URL

```bash
TOKEN="<HOSPITABLE_WEBHOOK_URL_TOKEN value>"

# Wrong token → 404
curl -i -X POST https://app.chezsoistays.com/api/webhooks/hospitable/wrong-token \
  -H 'Content-Type: application/json' -d '{"id":"smoke","action":"test"}'
# Expect: HTTP 404

# Right token → 200
curl -i -X POST https://app.chezsoistays.com/api/webhooks/hospitable/$TOKEN \
  -H 'Content-Type: application/json' -d '{"id":"smoke-prc","action":"test"}'
# Expect: HTTP 200  {"received":true}

# GET with right token → liveness
curl https://app.chezsoistays.com/api/webhooks/hospitable/$TOKEN
# Expect: {"ok":true,"service":"hospitable-webhook"}
```

In the Convex dashboard, table `hospitableWebhookEvents` should now show two new rows (one per smoke test).

## 6. Register the webhook in Hospitable

1. Hospitable dashboard → **Apps → Webhooks → +Add new**
2. **Name:** `OpsCentral – reservations` (or similar)
3. **Destination URL:** `https://app.chezsoistays.com/api/webhooks/hospitable/<HOSPITABLE_WEBHOOK_URL_TOKEN>`
4. **Webhook types:** Reservations (created / changed / cancelled). Properties / Messages / Reviews are out of scope for Phase 0.
5. **Save** → **Test** to fire a synthetic delivery.

## 7. 24h observation

For the first 24h after registration, the route logs a redacted snapshot of every header Hospitable sends. The Convex row's `signatureHeaders` column holds the same data per delivery.

After 24h, query the Convex dashboard:

```ts
// Convex Functions tab — ad-hoc query
const rows = await ctx.db.query("hospitableWebhookEvents").take(50);
return rows.map(r => ({ action: r.action, headers: Object.keys(r.signatureHeaders ?? {}) }));
```

Expected: no header name starting with `signature`, `x-hospitable-`, `x-signature-`, `x-webhook-signature` appears. Confirms the no-signature finding empirically.

## 8. Cleanup (follow-up PR D, after step 7)

- Drop the header-snapshot logging from `[token]/route.ts`.
- Drop `signatureValid` and `signatureHeaders` columns from `hospitableWebhookEvents` (Convex schema migration — coordinate with cleaners app).
- Delete this runbook's predecessor (`hospitable-webhook-deploy.md`) and the SUPERSEDED note.

## Rotation

If the URL token leaks:

1. Generate new token (step 1).
2. Update Vercel env (step 2).
3. Trigger redeploy (`vercel --prod` or push a no-op commit to main).
4. Update Hospitable dashboard URL (step 6).

Old deliveries to the old URL will 404, but Hospitable retries up to 5x within ~7h — acceptable loss for a leak event.
