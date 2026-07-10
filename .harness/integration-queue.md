# Integration Queue

Ready-for-integration tasks. Worktree sessions append to `## Ready`. Main session moves to `## Done` after merge.

## Ready

### TASK-COMPANIES-HUB-UI-001
- Branch: task/companies-hub-refined-ui
- Worktree: ~/sites/opscentral-admin-companies-hub-ui
- PR: https://github.com/Atemndobs/ops-central/pull/195
- Schema impact: none (frontend-only)
- Convex impact: none — no queries/mutations changed
- Risk: low (single component, no data-shape changes, same handlers reused)
- What: declutters the Companies Hub detail panel per a design critique — merges 3 redundant stat cards into one summary bar, groups members active-first with role pills + collapsed inactive section, demotes the always-open attach form to a popover trigger, merges duplicate Assignment History / Active Properties panels into one toggle-driven panel, unifies destructive-button styling
- CI: tsc clean, eslint clean, `npm run build` compiles
- Not verified: automated browser preview blocked by Clerk auth (no test credentials) — needs a human eyeball on `/companies` post-merge
- Handoff: .harness/handoffs/TASK-COMPANIES-HUB-UI-001/worktree-handoff.md

## In progress (main session integrating)

_None._

## Done

### TASK-B2-CDN-001
- Branch: task/b2-cloudflare-cdn
- Worktree: ~/sites/opscentral-admin-b2-cdn
- PR: https://github.com/Atemndobs/ops-central/pull/208 (merged → 0bdc992)
- Schema impact: none
- Convex impact: deploy-required, deployed to lovable-oriole-182 (behavior-neutral — CDN path dormant until `B2_CDN_*` env set)
- Risk: low (fully inert until enabled)
- What: private edge-cached Cloudflare Worker CDN in front of B2 (`infra/b2-cdn-worker`) + `createExternalReadUrl` emits signed CDN URLs for B2 when `B2_CDN_BASE_URL`+`B2_CDN_SIGNING_SECRET` set. Durable fix for B2 cap exhaustion.
- Merged: 2026-07-10
- Handoff: .harness/handoffs/TASK-B2-CDN-001/worktree-handoff.md · integration-result.md
- Post-merge: `npx convex deploy` ✓ (no _generated drift, no new functions), no regression (B2 photo presigned GET 200 with B2_CDN_* unset), sign.test.js 3/3, cleaners mirrored ✓. Enablement pending operator's Cloudflare setup (Worker deploy + DNS + secrets), then Convex env flip.

### TASK-STORAGE-SWITCH-001
- Branch: task/storage-provider-switch
- Worktree: ~/sites/opscentral-admin-storage-switch
- PR: https://github.com/Atemndobs/ops-central/pull/207 (merged → 3bbc88e)
- Schema impact: backward-compatible (`appSettings.storageProvider` optional, no index/backfill) — combined-PR exception
- Convex impact: deploy-required (deployed to lovable-oriole-182 — `appSettings.{listStorageProviders,getStorageProvider,setStorageProvider}` + schema field; provider-aware read path in `photoUrls`/`cleaningJobs.queries`/`files.mutations`)
- Risk: medium (shared photo read/write path; b2 rows unaffected — reads default to b2)
- What: admin-selectable object-storage backend (B2 ↔ MinIO) on the appSettings singleton + provider-aware reads (each object signed against its own `photos.provider`). Settings → Integrations → "Photo & video storage" picker.
- Merged: 2026-07-10
- Handoff: .harness/handoffs/TASK-STORAGE-SWITCH-001/worktree-handoff.md · integration-result.md
- Post-merge: deploy order = convex deploy (codegen) → build → push bindings (d8ab304). Build ✓, schema validation ✓, cleaners mirrored ✓. Ships INERT (defaults to b2; MinIO refused until `MINIO_*` set in Convex prod). Tailscale Funnel `https://minio.goose-neon.ts.net` verified: presigned GET returns 200 off-tailnet, so MinIO serving is viable once env is set + a scoped key/`job-photos` bucket created. Existing broken B2 thumbnails need the B2 cap raised (not fixed by this — they live in B2).

### TASK-OWNER-DRAFT-ERROR-001
- Branch: task/owner-draft-engine-error
- Worktree: ~/sites/opscentral-admin-owner-draft-fix
- PR: https://github.com/Atemndobs/ops-central/pull/186 (merged → e3cb6ba)
- Schema impact: none
- Convex impact: deploy-required (deployed to lovable-oriole-182 — `owner/queries.getOwnerStatementDraft` error envelope, `owner/mutations.upsertPropertyFeeConfig`/`upsertPropertyOwners` first-row backdating, new `convex/lib/effectiveFrom.ts`)
- Risk: low (bug fix + defensive envelope; mobile hook already handles the error-union shape; no schema/index changes)
- What: fixes owner property page "Server Error" crash for newly onboarded owners (root cause: `pickFeeConfigForPeriod` threw a plain Error, `getOwnerStatementDraft` was the one owner query that didn't catch it) + prevents recurrence by backdating first-ever fee-config/owner rows to the property's first-activity month
- Merged: 2026-07-04
- Handoff: .harness/handoffs/TASK-OWNER-DRAFT-ERROR-001/worktree-handoff.md
- Post-merge: rebased locally to resolve a queue-file conflict with #185, force-pushed worktree branch, then merged. `npx convex deploy` ✓, build ✓, tests 13/13 (ownership-helpers + view-resolution + effective-from + fee-config-period) ✓, cleaners mirrored ✓.
- **Task 0 prod data repair executed** (main-session-only, per handoff doc): `owner/mutations:backdateOwnerSeed` run against prod for Tataw's property (`rs7892htyjbe7x7yxg39frbqr9853zyb`, effectiveFrom 2026-01-01 UTC) → `{touchedOwners:1, touchedConfigs:1}`. Verified via `debugEngineBreakdown` for both 2026-06 and 2026-07 — both return `totals` with no `error` key. Tataw's owner portal is unblocked.

### TASK-OWNER-CONSISTENCY-001
- Branch: task/owner-consistency
- Worktree: ~/sites/opscentral-admin-owner-consistency
- PR: https://github.com/Atemndobs/ops-central/pull/185 (merged → 95bb862)
- Schema impact: backward-compatible (`portfolioViews.ownerUserId` optional, no index/backfill) — combined-PR exception
- Convex impact: deploy-required (deployed to lovable-oriole-182 — schema + `strCosts/views.*`, `admin/queries.getTeamMetrics`, `admin/ownerOverview.listOwners`)
- Risk: low (admin/web-only; additive fields; no mobile client calls; owner-bound views fall back to stored snapshot if link breaks)
- What: makes `propertyOwners` the single source of truth for owner↔property across Team page, Owner Overview, and Monthly Close views (fixes role=owner users like Tataw John being invisible in Overview/statements)
- Merged: 2026-07-04
- Handoff: .harness/handoffs/TASK-OWNER-CONSISTENCY-001/worktree-handoff.md
- Post-merge: deployed alongside #186 in the same `npx convex deploy` call. Build ✓, tests ✓, cleaners mirrored ✓.

### TASK-REVIEW-RESPONSE-AI
- Branch: task/review-response-ai
- Worktree: ~/sites/opscentral-admin-review-response-ai
- PR: https://github.com/Atemndobs/ops-central/pull/184 (merged)
- Schema impact: backward-compatible (additive `guestReviews` table + 3 indexes + `reviewsAiReply` feature flag)
- Convex impact: deploy-required (deployed to lovable-oriole-182 — new `guestReviews.*` module + indexes: `by_hospitable_review_id`, `by_property`, `by_status`)
- Risk: low-medium (new domain touching live-publish path to Airbnb — gated behind `reviewsAiReply` flag default OFF, and blocked on separate Hospitable OAuth `reviews:read`/`reviews:write` scope grant)
- Merged: 2026-07-03
- Handoff: .harness/handoffs/TASK-REVIEW-RESPONSE-AI/worktree-handoff.md
- Post-merge: `npx convex deploy` ✓ (3 new indexes added), build ✓, guestReviews + reviewResponseDraft tests 17/17 ✓, cleaners mirrored ✓.
- Business follow-ups (out of code scope): (1) re-authorize Hospitable OAuth with `reviews:read` + `reviews:write` scopes; (2) flip `reviewsAiReply` flag ON via Settings → Integrations → Feature Flags once OAuth is granted.

### TASK-OWNER-COMPANY-001
- Branch: feat/owner-company-statement
- Worktree: ~/sites/opscentral-admin-owner-company
- PR: https://github.com/Atemndobs/ops-central/pull/183 (merged → 754cc35)
- Schema impact: backward-compatible (additive optional `users.company`)
- Convex impact: deploy-required (deployed to lovable-oriole-182, mirrored to cleaners)
- Risk: low (additive field; statement client = company ?? name)
- Merged: 2026-07-01
- Handoff: .harness/handoffs/TASK-OWNER-COMPANY-001/worktree-handoff.md
- Post-merge: `npx convex deploy` ✓, `setOwnerCompanyByEmail` one-off backfill executed for Randalls → "J&A Business Solutions LLC" (userId `th7661d4pt47cf53w2ndv6fgj98014sk`) ✓, build ✓, tests 9/9 ✓, cleaners mirrored ✓.

### TASK-VIEW-CLIENT-DROPDOWN-001
- Branch: feat/view-client-owner-dropdown
- Worktree: ~/sites/opscentral-admin-client-dropdown
- PR: https://github.com/Atemndobs/ops-central/pull/182 (merged → 2586ac7)
- Schema impact: none
- Convex impact: deploy-required (deployed to lovable-oriole-182 — new `views.listStatementClients` query)
- Risk: low (one additive read query + Client field input→select)
- Merged: 2026-07-01
- Handoff: .harness/handoffs/TASK-VIEW-CLIENT-DROPDOWN-001/worktree-handoff.md
- Post-merge: deployed alongside #183 in the same `npx convex deploy` call.

### TASK-PROPERTY-COSTS-001
- Branch: feat/property-costs-editor
- Worktree: ~/sites/opscentral-admin-costs
- PR: https://github.com/Atemndobs/ops-central/pull/181 (merged)
- Schema impact: none
- Convex impact: deploy-required (new `strCosts/costItems` module — deployed to lovable-oriole-182, mirrored to cleaners)
- Risk: low (additive — per-property cost-line editor + CRUD)
- Merged: 2026-06-30
- Handoff: .harness/handoffs/TASK-PROPERTY-COSTS-001/worktree-handoff.md
- Post-merge: rebase needed (queue collision with #180); resolved + force-pushed worktree branch. `npx convex deploy` ✓, build ✓, costMath.test.ts 9/9 ✓, cleaners mirrored ✓.

### TASK-MONTHLY-CLOSE-THEME-001
- Branch: fix/monthly-close-theme
- Worktree: ~/sites/opscentral-admin-mc-theme
- PR: https://github.com/Atemndobs/ops-central/pull/180 (merged → ca26c9d)
- Schema impact: none
- Convex impact: none (CSS/className-only)
- Risk: very low (converted named Tailwind utilities → `[var(--token)]` on `/reports/monthly-close` — Tailwind v4 has no `@theme` block so named utilities were silent no-ops)
- Merged: 2026-06-30
- Handoff: .harness/handoffs/TASK-MONTHLY-CLOSE-THEME-001/worktree-handoff.md
- Follow-up candidate: `src/components/admin/owner-overview/{StatementEditor,PropertySplitView}.tsx` use the same named utilities and likely have the same latent transparency bug.

### TASK-MONTHLY-CLOSE-001
- Branch: task/monthly-close
- Worktree: ~/sites/opscentral-admin-monthly-close
- PR: https://github.com/Atemndobs/ops-central/pull/179 (merged → b77393b)
- Schema impact: backward-compatible (additive optional `properties.pnlStatus` + new `portfolioViews` table)
- Convex impact: deploy-required (deployed to lovable-oriole-182; PR classified as dev-once but runtime calls to new `strCosts/*` functions needed prod deploy)
- Risk: low (additive schema; integration fix in 174fcfd: renamed schema field `status` → `pnlStatus` to avoid collision with the derived `status` attached by `convex/properties/queries.ts`)
- Merged: 2026-06-30
- Handoff: .harness/handoffs/TASK-MONTHLY-CLOSE-001/worktree-handoff.md
- Post-merge: `npm install` (`simple-icons` missing — pre-existing gap from #130), `npx convex deploy` → lovable-oriole-182, mirror via `npm run sync:convex-backend`. Lint clean in new code (188 pre-existing errors unchanged). Build green. `costMath.test.ts` 9/9.

### TASK-OWNER-OVERVIEW-PHASE-3
- Branch: feat/admin-owner-overview-split
- Worktree: ~/sites/opscentral-admin-owner-overview-split
- PR: https://github.com/Atemndobs/ops-central/pull/160 (merged)
- Schema impact: none
- Convex impact: none (consumes Phase 1 queries)
- Risk: low (UI-only, additive route)
- Merged: 2026-05-25
- Handoff: .harness/handoffs/TASK-OWNER-OVERVIEW-PHASE-3/worktree-handoff.md

### TASK-OWNER-OVERVIEW-PHASE-2
- Branch: feat/admin-owner-overview-ui
- Worktree: ~/sites/opscentral-admin-owner-overview-ui
- PR: https://github.com/Atemndobs/ops-central/pull/159 (merged)
- Schema impact: none
- Convex impact: none (consumes Phase 1 queries)
- Risk: low (UI-only, admin-gated nav)
- Merged: 2026-05-25
- Handoff: .harness/handoffs/TASK-OWNER-OVERVIEW-PHASE-2/worktree-handoff.md

### TASK-OWNER-OVERVIEW-PHASE-1
- Branch: feat/admin-owner-overview
- Worktree: ~/sites/opscentral-admin-owner-overview
- PR: https://github.com/Atemndobs/ops-central/pull/150 (merged)
- Schema impact: backward-compatible
- Convex impact: main-dev-once-required (deploy new schema fields + admin/ownerOverview module)
- Risk: low (additive schema, queries gated, no callers yet)
- Merged: 2026-05-25
- Handoff: .harness/handoffs/TASK-OWNER-OVERVIEW-PHASE-1/worktree-handoff.md

### TASK-MANAGER-SCOPE-001
- Branch: claude/gracious-borg-3d5a6e
- Worktree: ~/sites/jnabusiness_solutions/apps-ja/opscentral-admin/.claude/worktrees/gracious-borg-3d5a6e
- PR: https://github.com/Atemndobs/ops-central/pull/77 (merged) — follow-ups: #92, #95, #96
- Schema impact: none
- Convex impact: deploy-required
- Risk: medium (auth surface — flips manager behavior on prod)
- Merged: 2026-05-17
- Handoff: .harness/handoffs/TASK-MANAGER-SCOPE-001/worktree-handoff.md

### TASK-FIX-TASKS-001
- Branch: task/fix-tasks-feature
- Worktree: ~/sites/jnabusiness_solutions/apps-ja/opscentral-admin-fix-tasks
- PR: https://github.com/Atemndobs/ops-central/pull/61 (merged → c64bdf8)
- Schema impact: none
- Convex impact: main-dev-once-required (`npx convex dev --once` to regen api.ts for new queries)
- Risk: low
- Merged: 2026-05-02 18:34 UTC
- Handoff: .harness/handoffs/TASK-FIX-TASKS-001/worktree-handoff.md

---

## Entry format

```markdown
### TASK-<ID>
- Branch: task/<name>
- Worktree: ~/sites/opscentral-admin-<name>
- PR: <url>
- Schema impact: none | backward-compatible | schema-first-required | migration-required
- Convex impact: none | main-dev-once-required | deploy-required
- Risk: low | medium | high
- Ready since: YYYY-MM-DD HH:MM
- Handoff: .harness/handoffs/TASK-<ID>/worktree-handoff.md
```
