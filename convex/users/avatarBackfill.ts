/**
 * One-shot avatar backfill from Clerk → Convex `users.avatarUrl`.
 *
 * Why this exists:
 *   The mobile cleaner app's job-detail message preview reads sender avatars
 *   from `users.avatarUrl`. That field is only populated by `ensureUser` /
 *   `ClerkUserSync` when a user signs in to a client that has the sync wired
 *   up. Users whose records were created before the sync was added — or who
 *   simply haven't logged in to the web/mobile clients since — show up with
 *   no avatar (the mobile falls back to an initials chip).
 *
 *   This action calls Clerk's REST API for every Convex user that's missing
 *   an avatarUrl (or where `force: true`), reads `image_url`, and writes it
 *   into the Convex `users` row — respecting the existing
 *   `profileOverrides.avatarUrl` flag so manual overrides are preserved.
 *
 * Safety:
 *   - Admin-only public mutation entry point.
 *   - Internal action runs against Clerk's REST API using `CLERK_SECRET_KEY`,
 *     same secret already used by `convex/clerk/actions.ts`.
 *   - Internal mutation does the actual DB write so the action stays
 *     side-effect free outside of HTTP.
 *
 * Usage:
 *   - From an admin client / Convex dashboard:
 *       runMutation(api.users.avatarBackfill.runBackfill, { force: false })
 *     The mutation schedules the action and returns immediately. Watch logs
 *     in the Convex dashboard for per-user status.
 */
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { readProfileOverrides } from "../lib/profileMetadata";

const CLERK_API_URL = "https://api.clerk.com/v1";

type ClerkUserResponse = {
  id?: string;
  image_url?: string | null;
  has_image?: boolean;
};

/**
 * Internal entry point — schedules the backfill action and returns the
 * scheduled job id. Marked `internalMutation` so it cannot be invoked from
 * the client API: only callable from the Convex dashboard ("Act as a user"
 * NOT required) or from other Convex functions. The dashboard already gates
 * access to deployment owners, so explicit auth is unnecessary here and
 * would only block legitimate one-off invocations.
 *
 * Pass `force: true` to overwrite avatarUrls that are already populated
 * (e.g. when Clerk avatars have been rotated since the last sync).
 */
export const runBackfill = internalMutation({
  args: {
    force: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ scheduledId: string }> => {
    const scheduledId = await ctx.scheduler.runAfter(
      0,
      internal.users.avatarBackfill.backfillAll,
      { force: args.force ?? false },
    );
    return { scheduledId: String(scheduledId) };
  },
});

export const backfillAll = internalAction({
  args: {
    force: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    updated: number;
    skipped: number;
    failed: number;
    total: number;
  }> => {
    const apiKey = process.env.CLERK_SECRET_KEY;
    if (!apiKey) {
      throw new Error("CLERK_SECRET_KEY is not configured.");
    }

    const candidates = await ctx.runQuery(
      internal.users.avatarBackfill.listBackfillCandidates,
      { force: args.force ?? false },
    );

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const candidate of candidates) {
      try {
        const response = await fetch(
          `${CLERK_API_URL}/users/${candidate.clerkId}`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
          },
        );

        if (!response.ok) {
          console.warn(
            "[avatarBackfill] Clerk fetch failed",
            candidate.clerkId,
            response.status,
          );
          failed += 1;
          continue;
        }

        const body = (await response.json()) as ClerkUserResponse;
        const imageUrl = body.image_url?.trim();
        if (!imageUrl) {
          skipped += 1;
          continue;
        }

        await ctx.runMutation(internal.users.avatarBackfill.applyAvatar, {
          userId: candidate.userId,
          avatarUrl: imageUrl,
        });
        updated += 1;
      } catch (error) {
        console.error(
          "[avatarBackfill] Error processing user",
          candidate.clerkId,
          error,
        );
        failed += 1;
      }
    }

    console.log(
      `[avatarBackfill] done — updated=${updated} skipped=${skipped} failed=${failed} total=${candidates.length}`,
    );
    return { updated, skipped, failed, total: candidates.length };
  },
});

/**
 * Internal query — returns the user IDs and clerkIds needing a backfill.
 * Kept inside this module so call sites stay in one file. Not exposed as a
 * public query; only the action invokes it via `ctx.runQuery`.
 */
type BackfillCandidate = {
  userId: import("../_generated/dataModel").Id<"users">;
  clerkId: string;
};

export const listBackfillCandidates = internalQuery({
  args: {
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<BackfillCandidate[]> => {
    const force = args.force ?? false;
    const all = await ctx.db.query("users").collect();
    return all
      .filter((u) => {
        if (!u.clerkId) return false;
        const overrides = readProfileOverrides(u.metadata);
        if (overrides.avatarUrl) return false; // respect manual overrides
        if (force) return true;
        return !u.avatarUrl;
      })
      .map((u) => ({ userId: u._id, clerkId: u.clerkId as string }));
  },
});

export const applyAvatar = internalMutation({
  args: {
    userId: v.id("users"),
    avatarUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;
    const overrides = readProfileOverrides(user.metadata);
    if (overrides.avatarUrl) return; // never clobber manual overrides
    if (user.avatarUrl === args.avatarUrl) return; // no-op
    await ctx.db.patch(args.userId, {
      avatarUrl: args.avatarUrl,
      updatedAt: Date.now(),
    });
  },
});
