# Integration Queue

Ready-for-integration tasks. Worktree sessions append to `## Ready`. Main session moves to `## Done` after merge.

## Ready

### TASK-OWNER-COMPANY-001
- Branch: feat/owner-company-statement
- Worktree: ~/sites/opscentral-admin-owner-company
- PR: https://github.com/Atemndobs/ops-central/pull/183
- Schema impact: backward-compatible (additive optional `users.company`)
- Convex impact: convex-deploy-required (schema field + functions; web build green w/o regen). One-off: `setOwnerCompanyByEmail` for Randalls → "J&A Business Solutions LLC".
- Risk: low (additive field; statement client = company ?? name)
- Handoff: .harness/handoffs/TASK-OWNER-COMPANY-001/worktree-handoff.md

### TASK-VIEW-CLIENT-DROPDOWN-001
- Branch: feat/view-client-owner-dropdown
- Worktree: ~/sites/opscentral-admin-client-dropdown
- PR: https://github.com/Atemndobs/ops-central/pull/182
- Schema impact: none
- Convex impact: convex-deploy-required (`npx convex deploy` prod for new `views.listStatementClients`; web build is green WITHOUT regen since the query is on the existing `views` module)
- Risk: low (one additive read query + Client/company field input→select; auto-scopes view to the picked owner's properties)
- Note: deploy Convex right after merge to avoid a transient "unknown function" error before the web build flips over.
- Handoff: .harness/handoffs/TASK-VIEW-CLIENT-DROPDOWN-001/worktree-handoff.md

## In progress (main session integrating)

_None._

## Done

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
