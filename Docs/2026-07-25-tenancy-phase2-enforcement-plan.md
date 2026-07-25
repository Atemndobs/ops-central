# Multi-Tenancy Phase 2: backfill + enforcement plan

- **Date:** 2026-07-25
- **Repo:** opscentral-admin (Convex owner). Prod deployment: `prod:lovable-oriole-182`.
- **Builds on:** Phase 1 (organizations table + `cleaningCompanies.organizationId` + `convex/lib/tenant.ts`), already merged and live on prod (additive).
- **Upstream plan:** `../jna-cleaners-app/docs/2026-07-24-multi-tenancy-kickoff-plan.md`.

> Order matters: **backfill first, verify zero unlinked, THEN enforce.** Never turn on
> enforcement while any `cleaningCompanies` row still lacks an `organizationId`, or that
> tenant's users get locked out.

## Step 1: Backfill (this PR): code ready, run gated

`convex/tenancy/backfill.ts` → `runJnaOrganizationBackfill` (pure, tested) + the
`backfillJnaOrganization` internal mutation. Idempotent: ensures one J&A `organizations`
row (slug `jna`, status `active`) and links every unlinked `cleaningCompanies` to it.

**Running it is a prod data write and needs explicit sign-off.** When approved:

```bash
cd opscentral-admin
npx convex run tenancy/backfill:backfillJnaOrganization   # hits prod:lovable-oriole-182
```

Then verify:

```bash
npx convex data organizations                              # expect exactly 1 row (J&A)
# every cleaningCompanies row should now have organizationId set:
npx convex data cleaningCompanies
```

Because tenancy is derived through the company tier (Phase 1 design), linking
`cleaningCompanies` is sufficient for `resolveCallerOrganization` to return the org for
every current user: no per-table backfill of the other ~55 tables is required.

## Step 2: Enforcement (next PR): behind a flag

1. **Status gate in `requireOrg`.** Extend `convex/lib/tenant.ts` so `requireOrg` also
   rejects when `!isOrganizationActive(org)` (canceled → lockout). Keep read vs mutation
   behaviour per the billing spec (canceled = read-only).
2. **Wire it in, guarded.** The toggle is a Convex **environment variable**
   `TENANCY_ENFORCED` (dashboard: Settings -> Environment Variables), read by
   `isTenancyEnforced` in `convex/lib/tenantGuard.ts`. Chosen over a `featureFlags` row
   because that table's `key` is a closed union, so a new flag would be a schema change
   (codegen + deploy); an env var flips instantly with no deploy. Default OFF (unset).
   Wire `callerSharesOrgForProperty` / the org guard into the scoped surfaces one at a
   time (started: `properties.getById`; remaining: `cleaningJobs`, `conversations`,
   `users`, list queries). Never trust a client-supplied org id.
3. **Isolation test (required).** A user in Org A cannot read or mutate Org B's jobs,
   properties, photos, or conversations. Add as a `node --test` logic test using the
   fake-ctx harness, plus one live smoke check on prod after enable.
4. **Flip the flag** only after backfill is verified and the isolation test is green.
   Coordinate with a mobile OTA (the app sets the active Clerk org on the session later).

## Step 3+: Onboarding + billing

Org self-serve signup (Clerk Organizations) and Stripe, per the billing spec
(`../jna-cleaners-app/docs/2026-07-24-stripe-billing-spec.md`).

## Safety

- Every `npx convex …` in this repo hits **prod**. Get sign-off before backfill and before
  flipping the enforcement flag.
- Enforcement lands OFF behind a flag so it can be reverted instantly without a redeploy.
