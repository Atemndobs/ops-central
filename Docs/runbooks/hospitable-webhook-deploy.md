# Runbook — Deploy Hospitable Webhook + 24h Observation

**Date:** 2026-05-18
**Phase:** P0.1 of [agentic-OS roadmap](../2026-05-18-agentic-os-roadmap.md)
**PR:** [#79 — task/hospitable-webhook](https://github.com/Atemndobs/ops-central/pull/79)
**Plan:** [2026-05-18-hospitable-webhook-implementation-plan.md](../2026-05-18-hospitable-webhook-implementation-plan.md)

This runbook covers the operational steps after PR #79 is merged: set secrets, deploy, point Hospitable at the endpoint, observe headers for 24h, then write PR C with the enforced header name.

---

## 0. Pre-merge checklist

- [ ] PR #79 reviewed and approved
- [ ] You have access to the Hospitable dashboard (to grab the webhook secret and configure the endpoint)
- [ ] You have admin access to Vercel project `opscentral-admin` and the Convex prod deployment `lovable-oriole-182`

---

## 1. Set the secret

The same `HOSPITABLE_WEBHOOK_SECRET` value goes in two places: Vercel (for the Next.js route) and Convex (for the mutation guard).

### 1a. Grab the value from Hospitable

1. Hospitable dashboard → Settings → Developers / Webhooks
2. Copy the existing webhook secret. If you can't find an existing one and only see "rotate", **don't rotate yet** — that invalidates existing deliveries. Confirm whether one is already configured.

> **If no secret exists at all in Hospitable yet:** create one in the dashboard, then mirror it to both Vercel and Convex below.

### 1b. Set in Vercel (Production + Preview)

From the main checkout (NOT this worktree):

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin

# Production
vercel env add HOSPITABLE_WEBHOOK_SECRET production
# (paste the value when prompted)

# Preview (so preview deploys can be smoke-tested with a stunnel/ngrok forward)
vercel env add HOSPITABLE_WEBHOOK_SECRET preview
# (paste the same value)
```

Verify:

```bash
vercel env ls production | grep HOSPITABLE
# Expect one row: HOSPITABLE_WEBHOOK_SECRET   Encrypted   Production
```

### 1c. Set in Convex (`lovable-oriole-182` prod)

From the main checkout:

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin

# Push the secret to prod env (this only sets the env var; does not deploy code)
npx convex env set HOSPITABLE_WEBHOOK_SECRET "<value>" --prod
```

Verify:

```bash
npx convex env list --prod | grep HOSPITABLE
```

---

## 2. Deploy

After #79 merges to `main`:

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin

git pull --ff-only origin main

# Convex first (so the mutation exists before traffic arrives)
npx convex deploy

# Vercel — handled by the auto-deploy on push to main, OR force it:
vercel --prod
```

### Smoke test (before pointing Hospitable at it)

```bash
# Liveness ping — expect {"ok":true,"service":"hospitable-webhook"}
curl -i https://ja-bs.com/api/webhooks/hospitable

# Malformed POST — expect 400
curl -i -X POST https://ja-bs.com/api/webhooks/hospitable \
  -H "Content-Type: application/json" \
  -d 'not json'

# Well-formed POST with bad secret — expect 200 (we still 200 by design) but
# Convex logs should show "Unauthorized: invalid Hospitable webhook ingest
# secret."
curl -i -X POST https://ja-bs.com/api/webhooks/hospitable \
  -H "Content-Type: application/json" \
  -d '{"id":"smoke-1","action":"reservation.created","data":{}}'
```

In the Vercel runtime logs you should see one `hospitable-webhook-received` entry per call.

---

## 3. Configure Hospitable to point at the endpoint

Hospitable dashboard → Settings → Developers / Webhooks:

- **URL:** `https://ja-bs.com/api/webhooks/hospitable`
- **Events to subscribe to (Phase 0 — reservations only):**
  - `reservation.created`
  - `reservation.changed` (and/or `reservation.updated` if both options exist — subscribe to both, our handler accepts either)
- **Save.**

Hospitable will issue a test delivery. Confirm:

```bash
# From the main checkout
npx convex run hospitable:queries.listWebhookEvents '{"limit":5}' --prod
# (If no listWebhookEvents query exists yet, query the dashboard:
#  Convex console → Data → hospitableWebhookEvents)
```

You should see one row with `signatureValid` and a non-empty `signatureHeaders` map.

---

## 4. 24h observation window

Goal: identify the real signature header name and confirm cancellation semantics.

### 4a. After ~24h, check:

```bash
# From the Convex dashboard or via CLI:
npx convex run hospitable:queries.listWebhookEvents '{"limit":50}' --prod
```

Look for:

1. **`signatureValid` distribution.** Some-true / some-false / all-false?
2. **`signatureHeaders` keys.** Which header name(s) actually appeared on real deliveries? Look at every row, not just the first.
3. **`action` distribution.** Did `reservation.changed` arrive on a cancellation? If yes, our `isCancelledStatus()` path should have flipped a job to cancelled — verify with a join against `cleaningJobs.metadata.reservationStatus`.

### 4b. Decision tree → PR C

| Observation | PR C enforces |
|---|---|
| One header consistently matched on every delivery | Enforce that header, reject if absent |
| Multiple headers matched (e.g. unprefixed + prefixed variant) | Accept any of the matching set |
| No header ever matched | **Stop and investigate.** Either the secret is wrong, or HMAC scheme is different (e.g. base64 vs hex, or includes a timestamp prefix like Stripe). Do **not** ship PR C until resolved. |
| Header matched but `signatureValid: false` mixed in | Hospitable may be rotating secrets, or there's a body-encoding issue (raw bytes vs string). Investigate before enforcing. |

### 4c. Lower the cron floor (optional)

If 24h of webhook traffic shows zero diffs vs the 6-hourly reconciliation cron, consider dropping the cron to once-per-day. Don't disable it entirely — it's our safety net.

---

## 5. PR C — enforce signature

Once the header is known:

1. New worktree off `origin/main`: `~/sites/opscentral-admin-hospitable-webhook-enforce`, branch `task/hospitable-webhook-enforce`.
2. In `src/app/api/webhooks/hospitable/route.ts`:
   - Replace `observeHospitableSignature` with `verifyHospitableSignature` that reads only the discovered header(s) and returns boolean.
   - On `false`, return `401`.
   - Remove `signatureHeaders` from the payload sent to Convex.
3. In `convex/schema.ts`:
   - Remove the `signatureHeaders` field from `hospitableWebhookEvents` (keep `signatureValid` as a permanent audit field).
4. In `convex/hospitable/webhooks.ts`:
   - Remove the `signatureHeaders` arg.
5. Open PR, merge, deploy.

### Forced-fail test (post-PR C)

```bash
# Wrong signature → 401
curl -i -X POST https://ja-bs.com/api/webhooks/hospitable \
  -H "Content-Type: application/json" \
  -H "<discovered-header-name>: wrongvalue" \
  -d '{"id":"forced-fail-1","action":"reservation.created","data":{}}'
# Expect: HTTP/1.1 401
```

---

## 6. Rollback procedure

If anything goes wrong after PR B deploy:

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin

# Option A: disable the webhook from Hospitable's side. Reconciliation cron
# (every 6h) keeps the system running, just laggier. No code change needed.

# Option B: revert just the cron change to restore hourly polling.
# Find the commit:
git log --oneline -- convex/crons.ts | head -5

# Apply a revert commit on a new branch and ship:
git checkout -b task/hospitable-webhook-rollback origin/main
# manually edit convex/crons.ts: { hours: 6 } → { hours: 1 }
# commit, push, merge, redeploy.
```

The `hospitableWebhookEvents` table is harmless to leave behind even if we revert the route — no other code reads from it.

---

## 7. Sign-off

- [ ] PR #79 merged
- [ ] Secrets set in Vercel (Prod + Preview) and Convex (`lovable-oriole-182`)
- [ ] Smoke tests pass
- [ ] Hospitable webhook configured and test delivery received
- [ ] 24h observation complete
- [ ] PR C drafted with enforced header name
- [ ] PR C merged + forced-fail test passes
- [ ] Mark P0.1 ✅ in [`2026-05-18-agentic-os-roadmap.md`](../2026-05-18-agentic-os-roadmap.md) changelog
