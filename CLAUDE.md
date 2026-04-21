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
- **Backend:** Convex (shared deployment `dev:usable-anaconda-394`)
- **Auth:** Clerk (`good-bluejay-68.clerk.accounts.dev`)
- **Charts:** Recharts
- **Icons:** Lucide React

---

## Convex Deployment

**CRITICAL:** This app shares a Convex deployment with the cleaners mobile app.

- URL: `https://usable-anaconda-394.eu-west-1.convex.cloud`
- Deployment: `dev:usable-anaconda-394`
- Team: `bertrand-atemkeng`
- Project: `opscentral-admin`

**Any schema change affects both apps.** Coordinate carefully.

## 🚨🚨 VERY IMPORTANT: ja-bs.com RUNS ON THE *DEV* CONVEX DEPLOYMENT

**Current reality (as of 2026-04-21):** the production Vercel site at
https://ja-bs.com is pointed at the Convex deployment labeled
**"Development"** in the Convex dashboard:

- Effective-prod DB: `usable-anaconda-394` (labeled *Development* in Convex)
- Unused real-prod DB: `optimistic-guanaco-990` (labeled *Production*, empty)

All production data — users, properties, jobs, incidents, photos,
messages — lives in `usable-anaconda-394`. The real "Production"
Convex deployment has never been used.

**What this means in practice:**
- **`npx convex dev --once` is what updates the live site.** It pushes
  to `usable-anaconda-394`.
- **`npx convex deploy` pushes to an unused deployment**
  (`optimistic-guanaco-990`) and has no effect on users. Skip it until
  the split below is done.
- There is no prod/dev separation right now. Any code or data change
  affects real users immediately.

**At go-live (before announcing / onboarding real customers):**
1. Export data from `usable-anaconda-394` and import into
   `optimistic-guanaco-990`.
2. Update Vercel env vars (`CONVEX_DEPLOYMENT`,
   `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`) to point
   at `optimistic-guanaco-990.eu-west-1.convex.cloud`.
3. Also clean the trailing `\n` currently present in those encrypted
   env values.
4. Redeploy Vercel.
5. Then `npx convex deploy` and `npx convex dev --once` behave as
   their names suggest: deploy → prod, dev → sandbox.

Until that migration runs, treat `usable-anaconda-394` AS PROD.

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
