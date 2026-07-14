# Convex Read-Cost Audit — 2026-07-14

> **Superseded as reference material** by
> [2026-07-14-convex-database-optimization-playbook.md](2026-07-14-convex-database-optimization-playbook.md)
> — the playbook has the complete 16-PR fix ledger, all learnings, and the prevention
> systems. This file is kept as the raw incident-day log.

**Trigger:** Convex prod (`lovable-oriole-182`) flagged over Free-plan limits.
**Signal:** July usage = **7.68 GB reads vs 61.7 MB writes → 124:1**, with spikes on
Jul 6 and Jul 11–13 that track heavy testing/activity days.

## Mechanism (why reads dwarf writes)

Convex bills reads by documents **scanned**, not returned. `.filter()` and an
index-less `.collect()` read *every* row in the table and discard non-matches;
only `.withIndex()` with a range bounds the read set. A reactive `useQuery`
**re-executes automatically whenever anything in its scanned range changes**.

So one small write (a message, a job status flip) triggers a full table scan —
multiplied by every connected client and every mount point. That multiplication
is exactly the 124:1 read/write ratio, and it scales with *activity*, not data
size — which is why reads spiked on busy days.

**Not** a broken schema/normalization problem: the schema has good indexes. It's
a handful of specific hot reactive queries scanning whole partitions.

## Findings (ranked by blast radius)

| # | Query | File | Status |
|---|-------|------|--------|
| 🔴 1 | `getUnreadConversationCount` — scans ALL open conversations, no limit, re-runs on every message; mounted in app shell | `convex/conversations/queries.ts:597` | **PR 2** (schema-first) |
| 🔴 2 | `listMyConversations` — same all-open scan + N+1 enrich | `convex/conversations/queries.ts:250` | **PR 2** |
| 🟠 3 | `stays.getInDateRange` — `by_checkout` lower-bound-only, walked all future reservations to +∞ | `convex/stays/queries.ts` | ✅ **PR 1 (#242)** |
| 🟠 4 | `opsTasks.listAssigneeAvatarsForRange` — `draggingIn` unbounded past-scan | `convex/opsTasks/queries.ts:286` | Deferred — `opsTasks` empty today; bound before it grows |
| 🟡 5 | `convexSnapshot` — daily 10-table × 50k-row self-count (~500k reads/day) | `convex/serviceUsage/convexSnapshot.ts` | ✅ **PR 1 (#242)** |
| 🟡 6 | `cleaningJobs.getAll` — capped 500 but reactively subscribed 10+ mount points | `convex/cleaningJobs/queries.ts:178` | Already capped; component-level de-subscription is a follow-up |

Also reactive-but-only-while-open (lower priority): serviceUsage dashboard
queries `listEvents` / `getServiceDetail` / `getOverview` re-read 200–500 events
per insert while `/settings/usage` is open.

## PR 1 — quick wins (#242, schema impact: none) — DONE

1. **`stays.getInDateRange`**: two-sided `by_checkin` range `[from - MAX_STAY_MS(180d), to)`,
   `checkOutAt > from` applied in memory. Same result set; reads bounded to the
   visible window + fixed lookback.
2. **`convexSnapshot`**: dropped fast-growing append-only tables from the row
   count (`serviceUsageEvents`, `serviceUsageRollups`, `conversationMessages`,
   `photos`), cap 50k→10k, cron daily→weekly. Kept the bounded `convex_events_24h`.

## PR 2 — the real cure for #1/#2 (schema-first)

`getUnreadConversationCount` is the dominant offender: it scans every open
conversation and re-runs on every message, from the always-mounted shell.

**Recommended design (low-risk, mostly additive):**
Track a per-user `inboxLastSeenAt: v.optional(v.number())` on `users` (or a small
`userInboxState` table). The unread **badge count** then becomes an
index-bounded read using the *existing* `by_status_last_message` index:

```ts
// eq(status,"open") + lastMessageAt > my lastSeen  → reads ONLY conversations
// newer than last seen, not the whole open set.
.withIndex("by_status_last_message", q =>
  q.eq("status","open").gt("lastMessageAt", inboxLastSeenAt ?? 0))
.take(CAP)              // then scope-filter in memory (managers only)
```

Set `inboxLastSeenAt = now` when the user opens the inbox / "mark all read".
Absent field ⇒ 0 ⇒ counts all open (identical to today) → **backward-compatible,
no backfill**. Trade-off: badge becomes "conversations updated since you last
opened the inbox" (collapses per-conversation read state for the *badge* only;
the inbox list keeps per-conversation `lastReadMessageAt`). Confirm this
semantics change with product before building.

- Alternative (heavier): per-user incremental counter table with message-send
  fan-out + read reset. Correct per-conversation but adds write fan-out and
  drift risk. Only if per-conversation badge precision is required.
- `listMyConversations`: add a `.take(CAP)` ceiling regardless, and paginate the
  inbox.

## Deferred follow-ups
- `opsTasks` `draggingIn`: add a lower-bound (`gte(anchorDate, rangeStart - MAX_TASK_SPAN)`) before the table grows.
- `cleaningJobs.getAll`: audit the 10+ reactive mount points; most list pages should paginate, not subscribe to 500 jobs.

## PR 3 (inbox "loads all houses") — CLOSED, no work needed
Investigated 2026-07-14. The Messages inbox has a single data query
(`listMyConversations`); the house list is **derived** from the returned
conversations (`groupByProperty` in `messages-inbox-client.tsx`), not a separate
"load all properties" query. So it's not a Convex cost, and "no conversations ⇒
nothing loaded" already holds. Admins see all houses only because they see all
conversations (the oversight kept in PR #243); managers/cleaners are already
scoped to their own houses by #243. Only open (product, not cost) question:
whether to scope the *admin* inbox to involvement too, trading oversight for a
tidier view.

## Immediate safety net
The fixes reduce steady-state cost, but if prod is throttling *now*, bumping off
the Convex Free plan buys headroom while PR 1 → PR 2 land.
