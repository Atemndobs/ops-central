# OpsCentral - Admin Web App

## What This Is

OpsCentral is the admin web dashboard for J&A Business Solutions' property care operations. It replaces the old jna-bs-admin app with a focused scheduling + reporting UI.

**Key principle:** This app is a **thin UI layer**. All business logic lives in Convex. The cleaners mobile app connects to the same Convex backend — do NOT duplicate logic here.

---

## Architecture

```
┌──────────────────┐       ┌──────────────────┐
│  OpsCentral      │       │  Cleaners App    │
│  (Next.js Web)   │       │  (Expo Mobile)   │
└────────┬─────────┘       └────────┬─────────┘
         │                          │
         └──────────┬───────────────┘
                    │
              ┌─────┴─────┐
              │  Convex   │
              │  Backend  │
              └───────────┘
```

- **Frontend:** Next.js 16 (App Router) + Tailwind CSS + shadcn/ui
- **Backend:** Convex (prod deployment `prod:lovable-oriole-182`, US region)
- **Auth:** Clerk (`good-bluejay-68.clerk.accounts.dev`)
- **Charts:** Recharts
- **Icons:** Lucide React

---

## Convex Deployment

**CRITICAL:** This app shares its Convex deployment with the cleaners mobile app.

- **Prod URL:** `https://lovable-oriole-182.convex.cloud`
- **Prod deployment:** `prod:lovable-oriole-182` (US region)
- **Team:** `bertrand-atemkeng`
- **Project:** `opscentral-admin-us`

> Migrated 2026-05-02 from the EU-region `whimsical-narwhal-849` /
> `usable-anaconda-394` deployments. Those are retired — do not push
> to them.

**Any schema change affects both apps.** Coordinate carefully.

**Shipping backend changes:** use `npx convex deploy` (with
`PROD_CONVEX_DEPLOY_KEY` from `.env.local`), not `npx convex dev`.
Node 20+ required (`nvm use lts/jod` if you're on nvm).

## 🚨 BIG FAT WARNING: CONVEX OWNER REPO

- `opscentral-admin` is the **only** backend owner for Convex deploy/dev/codegen.
- Running Convex from the wrong repo can overwrite shared functions and break both apps.
- Always run Convex commands here:

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin
npx convex <command>
```

- After owner backend changes, sync cleaners mirror:

```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/jna-cleaners-app
npm run sync:convex-backend
```

### Isolation Rule

- `jna-bs-admin` is a separate system and must not be re-coupled to this Convex deployment.
- Do not switch this app back to `upbeat-donkey-677` unless the user explicitly requests a rollback.

---

## Clerk Deployment

- Issuer URL: `https://good-bluejay-68.clerk.accounts.dev`
- Publishable key family: `pk_test_Z29vZC1ibHVlamF5LTY4...`

Both OpsCentral and cleaners mobile must use this same Clerk instance to share users.

---

## User Roles

| Role | Access |
|------|--------|
| `admin` | Full access to everything |
| `property_ops` | Scheduling, jobs, properties, team, reports |
| `manager` | Jobs, properties, team (read), reports |
| `cleaner` | Should use mobile app, not this web app |

---

## Page Structure

```
src/app/
├── (auth)/
│   ├── sign-in/          # Clerk sign-in
│   └── sign-up/          # Clerk sign-up
├── (dashboard)/
│   ├── page.tsx          # Dashboard (property readiness, today's jobs)
│   ├── schedule/         # Calendar view (PRIMARY operational view)
│   ├── jobs/             # Job list + job detail
│   ├── properties/       # Property list + property detail
│   ├── team/             # Cleaner/staff management + leaderboard
│   ├── inventory/        # Supply tracking per property
│   ├── work-orders/      # Maintenance requests
│   ├── reports/          # Operations, owner reports, analytics
│   └── settings/         # Scheduling rules, notifications, integrations
└── api/
    └── webhooks/
        └── hospitable/   # Reservation webhook for auto-scheduling
```

---

## Design System

- **Dark mode by default** (operations dashboard aesthetic)
- **Geist Sans** for UI text, **Geist Mono** for IDs/timestamps
- **Colors:**
  - Primary: Blue (actions)
  - Success: Green (completed)
  - Warning: Yellow (in-progress)
  - Destructive: Red (issues/rework)
  - Muted: Gray (scheduled/neutral)
- **Job status colors:** Gray → Blue → Yellow → Green → Red
- **Sidebar navigation** always visible on desktop

---

## Breezeway Patterns to Follow

1. **Schedule-first dashboard** — property × time grid, not generic stats
2. **Property Readiness** as the north star metric
3. **4-status job lifecycle** — Scheduled → Assigned → In Progress → Completed (+ Approved)
4. **Rule-based auto-scheduling** — IF trigger + conditions THEN create task + assign
5. **Draft vs Commit mode** — create tasks silently for review before notifying staff
6. **Section → Room → Item checklists** with typed requirements
7. **Inspection-to-work-order pipeline** — failed items create work orders inline
8. **Owner reports as polished output** — PDF/shareable links, separate from internal dashboards

---

## Development Commands

```bash
npm run dev        # Start dev server (Turbopack)
npm run build      # Production build
npm run lint       # ESLint
```

---

## Key Rules

1. **Never add business logic to Next.js** — all mutations/queries go through Convex
2. **Never break the cleaners app** — test schema changes against both apps
3. **Use Convex React hooks** for state — no Redux, no SWR, no fetch
4. **Use shadcn/ui components** — don't build custom UI primitives
5. **Keep pages as Server Components** by default — push `'use client'` down
6. **All request APIs are async** — `await params`, `await searchParams`, etc.

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

---

## Multi-Agent Orchestration (READ BEFORE STARTING WORK)

This repo runs with multiple parallel agent sessions (Claude Code, Codex, etc.). Coordination is **not** ad-hoc — there is a written protocol in `.harness/`.

### Two roles

- **Main session** = this checkout at `apps-ja/opscentral-admin/`. Owns integration, testing, Convex deploy, merge sequencing. Does **not** build features directly.
- **Worktree session** = a `git worktree` outside this checkout. Owns one branch, one task, one PR.

### If you are a worktree session

1. You are **not** in `apps-ja/opscentral-admin/`. You are in `~/sites/opscentral-admin-<task-name>/`.
2. Never run `npx convex deploy` or `npx convex dev`.
3. Rebase on `origin/main` before push and before PR.
4. Branch lifetime < 3 days. One feature only. No stacking.
5. When done: open PR, write `.harness/handoffs/<TASK-ID>/worktree-handoff.md`, append to `.harness/integration-queue.md`. Then stop.

### If you are the main session

1. You are in `apps-ja/opscentral-admin/` on `main`.
2. Read `.harness/integration-queue.md` for ready tasks.
3. Merge PR, pull, run lint/build, run `npx convex dev --once` only if `Schema impact` ≠ `none`.
4. Write `.harness/handoffs/<TASK-ID>/integration-result.md`.
5. Move queue entry from `## Ready` → `## Done`.

### Schema migration policy

- **Schema-first by default.** New required fields, renames, type changes, removed fields, migrations → ship as separate schema-only PR first.
- **Combined PR** allowed only for additive optional fields with no migration. See `.harness/convex.md`.

### Full rules

- `.harness/project-rules.md` — roles, lifecycle, forbidden actions
- `.harness/convex.md` — Convex command ownership and migration policy
- `.harness/worktrees.md` — exact `git worktree` commands
- `.harness/integration-queue.md` — current ready queue
- `.harness/handoffs/README.md` — handoff file template

---

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
