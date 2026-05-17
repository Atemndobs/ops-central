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
- **Backend:** Convex — `prod:lovable-oriole-182` (US, ja-bs.com prod). `dev:usable-anaconda-394` (EU) is the legacy/sandbox deployment, retired after the 2026-05-02 migration.
- **Auth:** Clerk (`good-bluejay-68.clerk.accounts.dev`)
- **Charts:** Recharts
- **Icons:** Lucide React

---

## Convex Deployment

**CRITICAL:** This app shares a Convex deployment with the cleaners mobile app.

- **Prod (live, used by ja-bs.com):** `lovable-oriole-182` (US, `https://lovable-oriole-182.convex.cloud` / `.convex.site`)
- **Dev/sandbox:** `usable-anaconda-394` (EU, legacy — kept only as historical reference, no live traffic)
- Team: `bertrand-atemkeng`
- Project: `opscentral-admin`

**Any schema change affects both apps.** Coordinate carefully.

## ja-bs.com prod = `lovable-oriole-182` (US)

Migrated from `whimsical-narwhal-849` to `lovable-oriole-182` on 2026-05-02 (US-region prod). Vercel prod env vars (`CONVEX_DEPLOY_KEY`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`) all point at `lovable-oriole-182.convex.{cloud,site}`.

**Commands in this repo:**
- `npx convex deploy` → pushes to `lovable-oriole-182` (real prod). Use this for prod backend releases.
- `npx convex dev` → spins up against the `dev:` deployment configured in `.env.local` (sandbox).

**Old note about `usable-anaconda-394` being effectively-prod is OBSOLETE** — that was the pre-2026-05-02 state when ja-bs.com was pointed at the EU "Development" deployment. Do not act on it.

## 🚨 BIG FAT WARNING: VERY DANGEROUS CONVEX DEPLOYMENT RULE

- This repo (`opscentral-admin`) is the Convex backend owner.
- Do **NOT** run Convex deploy/dev/codegen from `jna-cleaners-app`.
- Wrong-folder deployment can overwrite shared backend functions for both apps.

Owner command path:
```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin
npx convex <command>
```

After backend changes here, mirror to cleaners:
```bash
cd /Users/atem/sites/jnabusiness_solutions/apps-ja/jna-cleaners-app
npm run sync:convex-backend
```

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

**Canonical tokens and specs: [design-system/](design-system/)** — source of truth for both this web app and the mobile cleaner app. Import tokens via `@/design-system/tokens` (or relative path).

### Admin dashboard (ops-facing)
- **Dark mode by default** (operations dashboard aesthetic)
- **Geist Sans** for UI text, **Geist Mono** for IDs/timestamps
- **Colors:** oklch-based shadcn palette (see [design-system/tokens/colors.ts](design-system/tokens/colors.ts) `adminColors`)
- **Sidebar navigation** always visible on desktop
- **Job status colors on admin views:** Gray → Blue → Yellow → Green → Red (internal convention)

### Cleaner PWA (`/cleaner` routes)
- **Light mode default**, mobile-first, max-width `402px`
- **Fonts:** Spectral (display), Montserrat (body), Atkinson Hyperlegible (meta/mono)
- **Primary:** purple `#9b51e0` (light) / `#bd77ff` (dark)
- **Status pill appearances:** `open` · `in_review` · `completed` · `rework` — see [design-system/specs/StatusPill.md](design-system/specs/StatusPill.md)
- **Countdown tiers:** `calm` → `soon` → `urgent` — see [design-system/specs/CountdownBadge.md](design-system/specs/CountdownBadge.md)
- **Full component specs:** [design-system/specs/](design-system/specs/)

> **Note:** the workspace-level `CLAUDE.md` cites Navy `#1a237e` + Gold `#ffd700` as brand colors. Neither app currently uses those — the design-system tokens reflect actual current state. Brand-color consolidation is a separate effort.

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

## Multi-Agent Orchestration

This repo coordinates multiple parallel agent sessions via a written protocol. **Read `.harness/project-rules.md` before starting any task.**

- This checkout (`apps-ja/opscentral-admin/` on `main`) is the **integration/test/deploy** session. Do not build features directly here.
- Feature work happens in `git worktree` checkouts under `~/sites/opscentral-admin-<task>/` with branches `task/<name>` off `origin/main`.
- Convex `deploy`/`dev` runs only from this main session.
- Schema changes are **schema-first by default** — see `.harness/convex.md`.
- Worktree → main handoff is via PR + `.harness/handoffs/<TASK-ID>/worktree-handoff.md` + entry in `.harness/integration-queue.md`.
- See also `AGENTS.md` (this folder) and `../AGENTS.md` (workspace).

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
