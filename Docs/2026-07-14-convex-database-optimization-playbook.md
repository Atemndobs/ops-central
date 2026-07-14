# Convex Database Optimization Playbook

**Born from the 2026-07-14 read-cost incident.** This is the permanent record: what
happened, why, every fix that shipped, every learning, and the prevention systems now
in place. If you write or review a Convex function in this repo, the rules distilled
from this document live in [convex/CLAUDE.md](../convex/CLAUDE.md) and are enforced by
`npm run check:convex-readcost`.

Companion doc (raw incident log): [2026-07-14-convex-read-cost-audit.md](2026-07-14-convex-read-cost-audit.md)

---

## 1. The incident

- Convex prod (`lovable-oriole-182`) blew the Free-plan **6 GB Database I/O** cap:
  **10.66 GB by July 14** (day 14 of the cycle), with a "decrease usage or upgrade to
  avoid service interruption" banner threatening the live booking/ops backend.
- The signature: **reads 10.49 GB vs writes ~69 MB — a ~150:1 ratio.** Reads dwarfing
  writes by orders of magnitude is the fingerprint of **reactive read amplification**,
  not of a big database. Storage was only 209 MB.
- The absurdity that made it diagnosable: **an 8-property business generated ~10 GB of
  database reads in two weeks.** The data was never big. The *reads per unit of data*
  were.

### Root cause in one paragraph

Convex bills reads by documents **scanned**, and reactive queries **re-execute on every
write** to anything they read. A handful of queries scanned whole tables (or fat
documents) while subscribed on always-open screens. Every small write — a heartbeat
ping, an hourly Hospitable sync, a message — re-triggered scans across every connected
client. Cost = per-execution reads × write frequency × subscriber count. All three
factors were unbounded somewhere.

### Measured outcomes (same day)

| Metric | Before | After |
|---|---|---|
| Daily read rate | ~92 MB/h (Jul 13) | ~21 MB/h by Jul 14 evening (−77%, partially idle-hours) |
| Avg property document | 7,459 B | 2,128 B (−71% on *every* property read) |
| `properties.metadata` total | 42,282 B | 123 B |
| `properties.getAll` share of new reads | ~28% | ~10% |
| Function-call leak (`listForCell`) | 351K calls/mo (36% of ALL calls) | gate closed |

July itself was unrecoverable (the counter is cumulative); every fix protects the
following months.

---

## 2. The Convex cost model (memorize this)

1. **Reads are billed by documents SCANNED, not returned.**
2. **`.filter()` after `.query()` does NOT reduce reads.** It scans every row in range
   and discards non-matches server-side. Only `.withIndex()` with range bounds shrinks
   the scan.
3. **`ctx.db.get()` reads the ENTIRE document.** There is no field projection. A 7 KB
   document costs 7 KB even if you use one field.
4. **A reactive `useQuery` re-executes on EVERY write to any document in its read
   set.** Subscribing to a broad index range means subscribing to every write in it.
5. **Counting requires reading.** There is no count API; `.collect().length` reads
   every row it counts.
6. **`.take(N)` bounds the scan. `.slice(N)` after `.collect()` bounds only the
   response** — the reads already happened.
7. **`.take(N)` after `.filter()` is still unbounded** — it scans forward until it
   *finds* N matches (3,000 read + 2 unread notifications = 3,002 docs read to return 2).

---

## 3. The six root-cause anti-patterns

Every one of the ~30 findings reduced to one of these. All examples are real code from
this repo (pre-fix → post-fix).

### AP1 — Cap applied after the read
```ts
// ❌ reads everything, returns 500
const jobs = (await ctx.db.query("cleaningJobs").collect()).slice(0, 500);
// ✅ reads 500
const jobs = await ctx.db.query("cleaningJobs").withIndex("by_scheduled", q => q.gte(...)).take(500);
```
Seen in: `cleaningJobs.getAll` (2 branches), `getAssignable`, `refills.getQueue`,
`owner.listOwnerNotifications`, `getForCleaner` (no cap at all).

### AP2 — `.filter()` where an index exists
```ts
// ❌ scans the user's whole notification history
.withIndex("by_user", q => q.eq("userId", id)).filter(q => q.eq(q.field("readAt"), undefined))
// ✅ by_unread = ["userId", "readAt"] — existed in the schema, used NOWHERE
.withIndex("by_unread", q => q.eq("userId", id).eq("readAt", undefined))
```
Seen in: notifications (5 queries), `admin.getAllUsers` (`by_role` unused),
`hospitable.listStaysMissingTotalAmount` (`by_checkin` unused, in a **daily cron**),
`strCosts`/`owner` (`by_bucket`: **14 scan sites, zero index uses**).

### AP3 — Per-row helper that queries (the worst N+1)
```ts
// ❌ resolveGuestPhotoUrl ran a full stays-by-property .collect() PER REVIEW ROW
rows.map(async (row) => await resolveGuestPhotoUrl(ctx, row.propertyId, row.reviewedAt))
// ✅ fetch each property's stays ONCE (bounded), pick in memory
const staysByProperty = await fetchStaysByProperty(ctx, uniquePropertyIds, window);
```
Seen in: `guestReviews.listInbox` (~124 stay-scans per execution),
`owner.loadEngineInputs` (2 full scans per property per dashboard render),
`conversations.cleanerCanViewConversation` (2–3 reads per row in a sequential loop).
**Rule of thumb: a helper that takes `ctx` and gets called inside `.map()` is the bug.**

### AP4 — Fat documents (`v.any()` dumping grounds)
`properties.metadata` held the **raw Hospitable listing payload** — 5,346 B of the
7,459 B average document (**72%**), including 2.3 KB of marketing `description` that
nothing ever read. Since `ctx.db.get` reads whole documents, every job-detail,
schedule, and dashboard query paid for it, tens of thousands of times a month. The
current sync didn't even write it — it was stale legacy data. One allowlist prune
(PR #250) cut every property read 71%, permanently.
**Rule: measure documents with `npx convex data <table> --format jsonl` (the default
`pretty` format pads columns and gives bogus sizes).**

### AP5 — Scan-to-count
```ts
// ❌ up to 35,000 docs read to return 7 integers
for (const status of JOB_STATUSES_ALL) counts[status] = (await q.take(5000)).length;
```
Seen in: `getStatusCounts`, `getSchedulingMetrics`, `inventory.getGlobalStats`,
`users.getUnreadNotificationCount`, `countByProperty`. Real fix is denormalized
counters or bounded windows — a product decision, still open (see §7).

### AP6 — Reactive blast radius ignored
- `getUnreadConversationCount`: scanned all open conversations, mounted **3× in the
  app shell**, re-ran on **every message sent anywhere**.
- `enrichProperties`: read `.take(2000–10000)` of stays+jobs (whole tables at our
  scale) inside `properties.getAll`, subscribed on **10 pages** — every job/stay write
  re-ran it everywhere.
- `serviceUsage.getOverview`: unbounded event subscription → every event insert re-ran
  the whole N-service overview. The usage dashboard was one of the most expensive pages.
- The **loading-gate hole**: `summaryFor` returned `undefined` while its batch query
  loaded → every schedule cell un-skipped its per-cell query at once → **351K
  calls/month (36% of all function calls)**, all discarded a round-trip later. The
  gate also never resolved for non-ops users (the batch query threw "ops-only"), so
  for managers the eager path was open *permanently*.
  **Rule: `useQuery` loading states must fail CLOSED (render empty), never eager.**

---

## 4. Complete fix ledger (16 PRs, all merged + deployed 2026-07-14)

| PR | Area | Problem | Fix |
|---|---|---|---|
| [#242](https://github.com/Atemndobs/ops-central/pull/242) | stays / serviceUsage | Occupancy read walked all future stays; nightly self-report scanned 10 tables (~500K reads/day) | two-sided `by_checkin` bound; trimmed tables, cap 50k→10k, cron daily→weekly |
| [#243](https://github.com/Atemndobs/ops-central/pull/243) | conversations | Unread badge scanned ALL open conversations on every message (app shell ×3) | `users.inboxLastSeenAt` + bounded range for admin/ops; new `by_property_status` for managers |
| [#246](https://github.com/Atemndobs/ops-central/pull/246) | properties | **#1 consumer (2.61 GB)** — `enrichProperties` read whole stays+jobs tables per call, 10 mounts | per-property indexed reads (~14 rows vs ~4,000) |
| [#247](https://github.com/Atemndobs/ops-central/pull/247) | cleaningJobs | **#2 consumer (1.85 GB)** — `getById` read heartbeat-written sessions + 50 KB submission it never returned | `lightweight` mode skips those reads |
| [#249](https://github.com/Atemndobs/ops-central/pull/249) | admin | `getTeamMetrics` (773 MB): 4 full scans incl. all of cleaningJobs | bounded union: windowed `by_scheduled` + per-active-status `by_status` |
| [#250](https://github.com/Atemndobs/ops-central/pull/250) | properties | **72% of every property doc** was a dead Hospitable payload in `metadata` | one-off allowlist prune; 7,459→2,128 B/doc, verified live |
| [#251](https://github.com/Atemndobs/ops-central/pull/251) | guestReviews | **#3 consumer (1.16 GB)** — double N+1 (property get + full stays scan per review row) | dedupe + batch: 8 gets + 8 stay reads (was ~124+~124) |
| [#252](https://github.com/Atemndobs/ops-central/pull/252) | lib | Full `users` scan on **every job write** (hidden in `createOpsNotifications`; a second copy in acknowledgements) | use existing indexed `listOpsUserIds` (3× `by_role`); deleted the duplicate |
| [#253](https://github.com/Atemndobs/ops-central/pull/253) | schedule (client) | Loading-gate hole → 351K `listForCell` calls/mo (36% of ALL calls); permanent for non-ops | `summaryFor` always returns `emptyCellSummary` |
| [#254](https://github.com/Atemndobs/ops-central/pull/254) | cleaningJobs | `getForCleaner` had NO limit; on every cleaner's phone; grew with tenure | `.order("desc").take(500)` on the assignment read |
| [#255](https://github.com/Atemndobs/ops-central/pull/255) | hospitable/refills/inventory | 3 × "index exists, unused" incl. a daily cron full-scanning stays | bound on `by_checkin`, `by_property_and_status`, `by_status` |
| [#256](https://github.com/Atemndobs/ops-central/pull/256) | notifications | **SECURITY: IDOR** — public query took `userId` with no auth; + 5 unbounded reads (`by_unread` never used) | self-only auth; all 5 bounded on `by_unread`/`by_user_and_dismissed` |
| [#257](https://github.com/Atemndobs/ops-central/pull/257) | files | **FUNCTIONAL: photo archiving silently dead** (starvation) + cron was day-of-month %7, not weekly | new `by_archived_tier_and_uploaded` index, both un-archived states read; `interval({hours:168})` |
| [#258](https://github.com/Atemndobs/ops-central/pull/258) | opsTasks | 3 × `draggingIn` scans with no lower bound (latent ~36M reads/mo; scaled with feature AGE) | `DRAG_BACK_HORIZON_MS` (180d) on all three |
| [#259](https://github.com/Atemndobs/ops-central/pull/259) | admin | `listCompanyPropertyAssignments`: 3 full scans on the Properties page; `getAllUsers` ignored `by_role` | fan out from the bounded property set; index by role |
| [#260](https://github.com/Atemndobs/ops-central/pull/260) | guestReviews | Residual from #251: stay reads batched but unbounded | bounded to the photo-lookup window via `by_property_dates` + MAX_STAY_MS inference |

Bonus finding (not a PR): the retired EU deployment **`opscentral-admin` (usable-anaconda-394) is still running crons** — ~37% of team compute + 115 MB reads. Pause it from the dashboard (CLI cannot; pausing is dashboard-only, and beware: the live prod project is `opscentral-admin-us`, one suffix away).

---

## 5. Hard-won learnings (the expensive ones)

1. **Dashboard-driven fixing is whack-a-mole.** The usage dashboard only shows what is
   *already burning*. `guestReviews.listInbox` was invisible until a 124-review
   backfill lit it up overnight. A systematic sweep of all ~405 functions found ~30
   issues; the dashboard had surfaced 6.
2. **The reads hide in helpers.** `mutations.start` and `applyTransitionSideEffects`
   showed hundreds of MB with almost no direct `ctx.db` calls — the scan lived inside
   `createOpsNotifications`. Grep for `ctx.db.query` undercounts; trace helpers.
3. **Latent bombs scale with table AGE, not usage.** The opsTasks `draggingIn` scans
   were free (empty table) and would have degraded continuously after launch with
   nothing in the graphs to explain it. Fix scans while tables are empty.
4. **Duplicated helpers rot independently.** The indexed `listOpsUserIds` existed;
   `acknowledgements.ts` kept its own full-scan copy one import away. Same for
   `users.getMyNotifications` vs `notifications.getMyNotifications` (same name, two
   modules, different bugs).
5. **Optional fields have TWO un-set states.** `archivedTier` was `"hot"` on new rows
   and `undefined` on legacy rows. Indexing on `undefined` alone — the obvious fix —
   would have left archiving exactly as dead. Check every writer before indexing an
   optional field.
6. **Measurement gotchas:** `npx convex data` default `pretty` format pads columns
   (gave a bogus 19 KB/doc; jsonl showed 7.4 KB). `convex insights` needs an
   interactive user login (deploy keys refused). Cron name ≠ cron behavior
   (`*/7` day-of-month ≠ weekly). `crons.interval` takes hours, not days.
7. **The month is cumulative.** Once over the cap, no fix un-spends it. Fixes protect
   *next* month; the current month is an upgrade-or-ride-warnings decision only.
8. **tsc is a safety net for index types** — it caught a loose `v.string()` arg being
   passed to a union-typed index that a cast would have silently broken.
9. **Cheap × always-mounted beats expensive × rare.** Rank by
   per-exec reads × write frequency of the read set × subscriber count — not by how
   ugly the code looks.

---

## 6. Prevention systems now in place

| Layer | Where | What it does |
|---|---|---|
| **Authoring rules (auto-loaded)** | [convex/CLAUDE.md](../convex/CLAUDE.md) | Mandatory cost-model rules R1–R12 loaded into every AI session that touches `convex/`. |
| **Static checker + ratchet** | `scripts/check-convex-readcost.mjs` (`npm run check:convex-readcost`) | Flags bare `.collect()` without `withIndex`, `.filter()` on query chains, giant `.take()`. Committed baseline = current debt; **any NEW violation fails**. Ratchet down by fixing + `--update-baseline`. |
| **Review skill** | `.claude/skills/convex-readcost-review/` | Invocable checklist for reviewing any PR that touches `convex/`. |
| **Integrator checklist** | `.harness/convex.md` §Read-cost | Main session runs the checker before every Convex deploy; PRs adding scans need explicit justification. |
| **Measurement protocol** | this doc §7 | Weekly per-function Database I/O review; doc-size spot-checks via jsonl. |

### Measurement protocol (do this weekly, 5 minutes)
1. Dashboard → Usage → set range to the last 7 days → **Database I/O, breakdown by
   function**. Any function >200 MB/week gets a ticket.
2. `npm run check:convex-readcost` — should report 0 new violations.
3. Spot-check the fattest table: `npx convex data properties --limit 8 --format jsonl`
   → avg doc size should stay ~2 KB. If `metadata` grows again, something new is
   writing payloads.

---

## 7. Open items (decisions pending — deliberately not guessed)

| Item | Blocked on |
|---|---|
| `getReviewQueue` unbounded "All" branch | Product: bounding may drop old pending reviews off the queue top. What should "All" show? |
| `getStatusCounts` / `getSchedulingMetrics` / `inventory.getGlobalStats` | Product: denormalized counters (migration) vs time-windowed counts (numbers change meaning). |
| Mobile: `useConvexJobs` client-side filtering; `CleanerTopBar` pulls enriched jobs to count badges | Expo OTA release by owner. Server already accepts `status/from/to/limit` (`getMyAssigned`). |
| `getMyJobDetail` query split (903 MB) | Cross-app change on the cleaner hot path; re-measure post-fixes before deciding it's still worth the risk. |
| 7 dead admin queries that full-scan (`getAnalytics`, `getDashboardStats`, …) | Delete or mark `internal` — zero callers today, live footguns. |
| `upsertUserFromClerkWebhook` email fallback scan | Store normalized email or add `by_normalized_email` index. |
| Zombie EU deployment still running crons | Dashboard-only pause, by owner. Pause `opscentral-admin`, NOT `opscentral-admin-us`. |
| Convex Pro upgrade | Business call. July is over-cap regardless; watch Jul 15+ run-rate to decide if Free is viable for August. |
