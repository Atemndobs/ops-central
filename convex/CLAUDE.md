# Convex Read-Cost Rules (MANDATORY)

These rules exist because on 2026-07-14 this 8-property app hit **10.66 GB of database
reads against a 6 GB cap** — a ~150:1 read:write ratio caused entirely by the patterns
banned below. Full incident + rationale:
[Docs/2026-07-14-convex-database-optimization-playbook.md](../Docs/2026-07-14-convex-database-optimization-playbook.md).

Run `npm run check:convex-readcost` after editing any file here. New violations fail.

## Cost model (this is how Convex bills — internalize it)

1. Reads are billed by documents **SCANNED**, not returned.
2. `.filter()` after `.query()` does **NOT** reduce reads — it scans and discards.
3. `ctx.db.get()` reads the **ENTIRE** document (no field projection).
4. A reactive `useQuery` **re-executes on every write** to any doc in its read set.
   Cost = per-exec reads × write frequency of that range × subscriber count.
5. Counting requires reading — `.collect().length` reads every row it counts.
6. `.take(N)` bounds the scan; `.slice(N)` after `.collect()` does not.
7. `.take(N)` **after** `.filter()` is still unbounded — it scans until it *finds* N.

## Rules

- **R1 — No bare scans on growing tables.** Every `ctx.db.query` on a growing table
  MUST use `.withIndex()` with range bounds. Growing tables: `cleaningJobs`, `stays`,
  `photos`, `conversationMessages`, `conversations`, `notifications`,
  `serviceUsageEvents`, `serviceUsageRollups`, `guestReviews`, `userJobAssignments`,
  `jobExecutionSessions`, `jobSubmissions(Meta)`, `refillQueue`, `opsTasks`,
  `inventoryItems`, `incidents`, `hospitableWebhookEvents`, `pendingMediaUploads`.
  A bare `.collect()` is acceptable ONLY on small config tables (`appSettings`,
  `featureFlags`, `aiProviderSettings`, `hospitableConfig`, `costCategories`,
  `cleaningCompanies`, `instructionCategories`, `reviewResponseTemplates`)
  **with a comment saying so**. The bar for that list is that size is bounded by
  *configuration*, not by business activity — e.g. `reviewResponseTemplates` is a
  fixed 4x4 product of two enums (16 rows max; both writers dedupe on that key), so
  it cannot grow however many jobs the business does. "Small today" is NOT the bar:
  `photos` was small once.
- **R2 — Never `.filter()` to narrow reads when an index can.** Check `schema.ts`
  first — `by_unread`, `by_bucket`, `by_role`, `by_checkin`, `by_active`,
  `by_property_and_status` all existed unused during the incident. If a JS filter is
  genuinely unavoidable, bound the read first and comment why.
- **R3 — Never query inside a per-row loop/map/helper.** A helper that takes `ctx`
  and is called inside `.map()` IS the bug (guestReviews ran a full stays scan per
  review row). Dedupe ids into a Set, batch `ctx.db.get` via `Promise.all` over the
  deduped set, resolve in memory.
- **R4 — Apply limits at the read.** `.take(cap)` on the index, never
  `.collect().slice(cap)`. Every list query MUST have a hard cap (see
  `GET_ALL_HARD_CAP` / `GET_FOR_CLEANER_HARD_CAP` precedents).
- **R5 — Keep documents thin.** Never dump raw API payloads into `v.any()` fields —
  `properties.metadata` held a dead 5.3 KB Hospitable blob = 72% of every property
  read for months. Heavy or rarely-read data goes in a side table keyed by parent id.
- **R6 — App-shell subscriptions must be tiny.** Anything subscribed from
  layout/header/sidebar/bottom-nav/CleanerTopBar re-runs for every user on every
  write to its range. Point-lookups and index-bounded counts only.
- **R7 — Optional fields have TWO un-set states.** A field can be `undefined`
  (legacy rows) AND a sentinel (`"hot"`). Before indexing on an optional field, grep
  every writer; handle both states (`archivedTier` starvation trap).
- **R8 — No scan-to-count.** Counts over growing tables need a denormalized counter
  or an explicitly bounded window — never `.collect().length` / `.take(5000).length`.
- **R9 — Crons must be bounded and scheduled correctly.** Two-sided range bounds on
  any cron touching a growing table. `*/7` in cron day-of-month is NOT weekly (it
  fires 1st/8th/15th/22nd/29th). `crons.interval` takes `{hours}`, not `{days}`.
- **R10 — Auth on every public function.** `getCurrentUser`/`requireRole` first; never
  trust a `userId` arg for scoping (the notifications IDOR). Self-only checks return
  `[]`, not throw, to avoid crashing reactive subscriptions.
- **R11 — No duplicate helpers, no orphan indexes.** Before writing a helper, grep
  for an existing one (`listOpsUserIds` existed indexed while a full-scan copy ran on
  every job write). Before adding an index, check it isn't already there; when adding
  one, use it.
- **R12 — Client loading states fail CLOSED.** A `useQuery` gate that returns
  `undefined` while loading can un-skip N per-cell queries at once (351K wasted
  calls/mo). Default to empty/skip, never to eager.

## Verification tools

- `npm run check:convex-readcost` — static scan + ratchet baseline. **Gated in CI**
  (`.github/workflows/convex-readcost-check.yml`) on every PR, so a new violation
  fails the build rather than surfacing in a manual audit days after it merged.
  If it fails, fix the query — don't reach for `--update-baseline --force` unless
  the scan is genuinely justified (small config table, one-off migration), and say
  why in the PR. The baseline diff is reviewable precisely so that call is visible.
- `npx convex data <table> --limit 8 --format jsonl` — real doc sizes. NEVER trust the
  default `pretty` format for sizes (column padding lies).
- Dashboard → Usage → breakdown by function (Database I/O tab) is ground truth for
  what actually burns. `npx convex insights` requires interactive login.
- Node 20+ required for the Convex CLI (`nvm use lts/jod`).
