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
- **Backend:** Convex (shared deployment `dev:upbeat-donkey-677`)
- **Auth:** Clerk (`informed-marlin-31.clerk.accounts.dev`)
- **Charts:** Recharts
- **Icons:** Lucide React

---

## Convex Deployment

**CRITICAL:** This app shares a Convex deployment with the cleaners mobile app.

- URL: `https://upbeat-donkey-677.convex.cloud`
- Deployment: `dev:upbeat-donkey-677`
- Team: `bertrand-atemkeng`
- Project: `jnabs`

**Any schema change affects both apps.** Coordinate carefully.

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
