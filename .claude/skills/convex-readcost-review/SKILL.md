---
name: convex-readcost-review
description: Review Convex functions for read-cost anti-patterns before they ship. Use whenever a PR or working diff touches convex/ queries/mutations/crons, when adding a new useQuery subscription, when a Convex usage/bandwidth alert appears, or when asked to "check read cost" / "review this Convex change". Complements convex-performance-audit (which diagnoses live problems); this skill PREVENTS new ones at authoring/review time.
---

# Convex Read-Cost Review

Gate every Convex change against the cost model that produced the 2026-07-14 incident
(10.66 GB reads / 6 GB cap from 8 properties). Authoritative references:

- Rules: [convex/CLAUDE.md](../../../convex/CLAUDE.md) (R1–R12)
- Full rationale + fix ledger: [Docs/2026-07-14-convex-database-optimization-playbook.md](../../../Docs/2026-07-14-convex-database-optimization-playbook.md)

## Procedure

1. **Run the checker first**: `npm run check:convex-readcost`. Any NEW violation vs
   the baseline is a hard stop — fix it, don't baseline it (baselining requires
   explicit human sign-off in the PR).

2. **For every touched query/mutation, answer the four questions:**
   - **Scan**: does every `ctx.db.query` go through `.withIndex()` with range bounds
     on a growing table? Is any `.filter()` doing work an index should do?
   - **Fan-out**: is anything queried inside a per-row map/loop/helper? (A helper
     taking `ctx` called per row = the guestReviews bug.) Are repeated ids deduped?
   - **Cap**: is the limit applied as `.take()` at the read, not `.slice()` after?
     Does the query have ANY cap? (`getForCleaner` had none.)
   - **Blast radius**: who subscribes to this, from where, and what writes invalidate
     it? App-shell mounts × hot write ranges is the multiplier that turns a cheap
     query into gigabytes. Rank severity = per-exec reads × write freq × subscribers.

3. **For schema changes:** every new index must have a caller in the same PR; every
   new optional field's writers must be enumerated (two un-set states trap:
   `undefined` + sentinel). No raw payloads into `v.any()` fields — side table.

4. **For crons:** two-sided bounds on growing tables; verify the schedule semantics
   (`*/7` day-of-month ≠ weekly; `crons.interval` takes `{hours}` not `{days}`).

5. **For client changes adding `useQuery`:** loading gates fail CLOSED (empty/skip,
   never eager-on-undefined — the 351K-calls bug); no per-cell/per-row subscriptions
   without a batched summary path; nothing heavy in always-mounted components.

6. **For new public functions:** `getCurrentUser`/`requireRole` before any read;
   never scope by a caller-supplied `userId` (the IDOR).

7. **Verify sizes with jsonl, never the pretty table**:
   `npx convex data <table> --limit 8 --format jsonl` (pretty pads columns and lies).

## Red flags that end the review immediately

- `ctx.db.query("...").collect()` with no `withIndex` on a growing table
- `.filter(` between `query(` and the terminator
- `await` inside `for`/`.map()` hitting `ctx.db` per row
- `.take(5000)`+ or `.collect().length` used as a count
- A helper duplicated from `lib/` "to keep the diff small"
- `limit` argument accepted but applied post-`.collect()`
