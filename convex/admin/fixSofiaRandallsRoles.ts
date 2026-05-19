/**
 * One-off data fix — swap company-membership roles for Sofia and Randalls.
 *
 * Why
 * ───
 * Discovered 2026-05-19 while debugging the mobile "Team" tab returning [].
 * `users.queries.getCleaners` gates on the caller's `companyMembers.role`
 * being "manager" or "owner"; for Sofia it was "cleaner", so the query
 * fail-closed even though her platform `users.role` is "manager".
 *
 * Intended state per company owner (Bertrand, 2026-05-19):
 *   - Sofia (th78rtb4n0aer65wsx9kht646h83sfdt) = MANAGER of company
 *     ks7atgx79s6xzp858vb83y22fh83sehq
 *   - Randalls (th7661d4pt47cf53w2ndv6fgj98014sk) = CLEANER of the same company
 *
 * Current production state (verified 2026-05-19 12:14 UTC):
 *   - companyMembers m5743qcmzcdmv0fbwg56de851x83r7dy → Sofia,    role=cleaner   (WRONG)
 *   - companyMembers m578z0xb3w16cybfksz6htpnsn83sds0 → Randalls, role=manager   (WRONG)
 *
 * Platform `users.role` values are already correct (Sofia=manager,
 * Randalls=cleaner) — only the companyMembers rows need swapping.
 *
 * Safety
 * ──────
 * - **Idempotent**: re-running after the swap is a no-op; the mutation
 *   checks each row's current role before writing.
 * - **Defensive**: verifies the rows still point to the expected userId
 *   before mutating. Aborts on any mismatch — never silently writes the
 *   wrong row.
 * - **Logged**: returns a structured result describing what changed.
 *
 * Usage
 * ─────
 *   npx convex run admin/fixSofiaRandallsRoles:apply
 *
 *   # or via csoi:
 *   csoi raw admin/fixSofiaRandallsRoles:apply
 *
 * Deletion plan
 * ─────────────
 * After the fix is verified in prod (mobile Team tab shows the cleaners
 * for Sofia, web Team Management unchanged), this file should be deleted
 * in a follow-up PR. It's a one-shot migration, not ongoing infra.
 */
import { mutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// Hardcoded because this is a one-off fix for known production rows.
// Anyone tempted to make this "generic" — don't. Make a new file with
// the new specifics; that keeps the audit trail clean per-fix.
const SOFIA_USER_ID = "th78rtb4n0aer65wsx9kht646h83sfdt" as Id<"users">;
const RANDALLS_USER_ID = "th7661d4pt47cf53w2ndv6fgj98014sk" as Id<"users">;
const SOFIA_MEMBERSHIP_ID = "m5743qcmzcdmv0fbwg56de851x83r7dy" as Id<"companyMembers">;
const RANDALLS_MEMBERSHIP_ID = "m578z0xb3w16cybfksz6htpnsn83sds0" as Id<"companyMembers">;

export const apply = mutation({
  args: {},
  handler: async (ctx) => {
    const sofia = await ctx.db.get(SOFIA_MEMBERSHIP_ID);
    const randalls = await ctx.db.get(RANDALLS_MEMBERSHIP_ID);

    if (!sofia) {
      throw new Error(`Sofia's membership row ${SOFIA_MEMBERSHIP_ID} not found`);
    }
    if (!randalls) {
      throw new Error(`Randalls' membership row ${RANDALLS_MEMBERSHIP_ID} not found`);
    }
    if (sofia.userId !== SOFIA_USER_ID) {
      throw new Error(
        `Membership row ${SOFIA_MEMBERSHIP_ID} userId mismatch — expected ${SOFIA_USER_ID}, got ${sofia.userId}. ABORTING.`,
      );
    }
    if (randalls.userId !== RANDALLS_USER_ID) {
      throw new Error(
        `Membership row ${RANDALLS_MEMBERSHIP_ID} userId mismatch — expected ${RANDALLS_USER_ID}, got ${randalls.userId}. ABORTING.`,
      );
    }
    if (sofia.companyId !== randalls.companyId) {
      throw new Error(
        `Sofia and Randalls are in different companies — Sofia=${sofia.companyId}, Randalls=${randalls.companyId}. ABORTING.`,
      );
    }

    const updates: Array<{ name: string; before: string; after: string }> = [];

    if (sofia.role !== "manager") {
      await ctx.db.patch(SOFIA_MEMBERSHIP_ID, { role: "manager" });
      updates.push({ name: "Sofia", before: sofia.role, after: "manager" });
    } else {
      updates.push({ name: "Sofia", before: "manager", after: "manager (no-op)" });
    }

    if (randalls.role !== "cleaner") {
      await ctx.db.patch(RANDALLS_MEMBERSHIP_ID, { role: "cleaner" });
      updates.push({ name: "Randalls", before: randalls.role, after: "cleaner" });
    } else {
      updates.push({ name: "Randalls", before: "cleaner", after: "cleaner (no-op)" });
    }

    return {
      companyId: sofia.companyId,
      updates,
    };
  },
});
