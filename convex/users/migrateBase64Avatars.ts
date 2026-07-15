/**
 * One-off migration: move `data:` avatars out of `users.avatarUrl` and into
 * Convex file storage.
 *
 * WHY
 * ---
 * Measured on prod 2026-07-15: 3 of 19 users had `data:image/jpeg;base64,...`
 * avatars — 246 KB, 29 KB, and 8.6 KB — making `avatarUrl` 98% of the users table
 * (286 KB of 293 KB). Because `users` is the hottest table and Convex has no field
 * projection, every one of the ~135k monthly user reads paid for those bytes.
 * See Docs/2026-07-14-convex-database-optimization-playbook.md (AP4: fat documents).
 *
 * This *migrates* rather than clears: the images are decoded and re-stored as
 * files, so the affected users keep the photo they picked. `users/avatarUpload.ts`
 * is now the only way to set an uploaded avatar, and `lib/avatarUrl.ts` rejects
 * `data:` URIs on every write path, so the bloat cannot regrow.
 *
 * WHY THE OVERRIDE FLAG MATTERS
 * -----------------------------
 * All three rows carry `metadata.profileOverrides.avatarUrl = true` (they came
 * from the old manual upload). Every Clerk sync path skips overridden fields — so
 * simply clearing `avatarUrl` would have left those users with no avatar
 * permanently, with nothing to repopulate it. Migrating preserves both the image
 * and the override, which stays correct: it's still a deliberate manual choice.
 *
 * Run (dry run first — it defaults to one):
 *   npx convex run users/migrateBase64Avatars:migrateBase64Avatars '{"dryRun":true}'
 *   npx convex run users/migrateBase64Avatars:migrateBase64Avatars '{"dryRun":false}'
 */
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { type Id } from "../_generated/dataModel";
import { isUnstorableAvatarUrl } from "../lib/avatarUrl";

type LegacyAvatarUser = {
  userId: Id<"users">;
  email: string;
  avatarUrl: string;
};

export const listLegacyAvatarUsers = internalQuery({
  args: {},
  handler: async (ctx): Promise<LegacyAvatarUser[]> => {
    // Full scan is intentional and one-off: this is a migration over a ~19-row
    // table, not a reactive query. Do not copy this pattern into app code.
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => isUnstorableAvatarUrl(u.avatarUrl))
      .map((u) => ({
        userId: u._id,
        email: u.email,
        avatarUrl: u.avatarUrl as string,
      }));
  },
});

export const applyMigratedAvatar = internalMutation({
  args: {
    userId: v.id("users"),
    storageId: v.id("_storage"),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) return null;

    const previousStorageId = user.avatarStorageId;

    await ctx.db.patch(args.userId, {
      avatarUrl: url,
      avatarStorageId: args.storageId,
      updatedAt: Date.now(),
    });

    if (previousStorageId && previousStorageId !== args.storageId) {
      await ctx.storage.delete(previousStorageId);
    }

    return url;
  },
});

/**
 * Split a `data:` URI into its MIME type and raw bytes.
 * Returns null for anything that isn't a base64 data URI we can decode.
 */
function decodeDataUri(
  value: string,
): { mimeType: string; buffer: ArrayBuffer } | null {
  // `[\s\S]*` rather than `.` + the `s` flag: the app tsconfig targets below
  // es2018, where that flag isn't available.
  const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(value.trim());
  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  try {
    const binary = atob(match[2]);
    // Allocate the ArrayBuffer up front so the result is a BlobPart.
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { mimeType, buffer };
  } catch {
    return null;
  }
}

export const migrateBase64Avatars = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    dryRun: v.boolean(),
    scanned: v.number(),
    migrated: v.number(),
    skipped: v.number(),
    failed: v.number(),
    bytesReclaimed: v.number(),
    details: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    // Default to a no-write dry run so an accidental invocation is harmless.
    const dryRun = args.dryRun ?? true;

    const candidates: LegacyAvatarUser[] = await ctx.runQuery(
      internal.users.migrateBase64Avatars.listLegacyAvatarUsers,
      {},
    );

    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    let bytesReclaimed = 0;
    const details: string[] = [];

    for (const candidate of candidates) {
      const decoded = decodeDataUri(candidate.avatarUrl);
      if (!decoded) {
        // An oversized non-`data:` URL — nothing to migrate, and we won't guess.
        skipped += 1;
        details.push(
          `SKIP ${candidate.email} — not a decodable base64 data URI (${candidate.avatarUrl.length}B)`,
        );
        continue;
      }

      if (dryRun) {
        migrated += 1;
        bytesReclaimed += candidate.avatarUrl.length;
        details.push(
          `WOULD MIGRATE ${candidate.email} — ${candidate.avatarUrl.length}B ` +
            `${decoded.mimeType} → file storage (${decoded.buffer.byteLength}B file)`,
        );
        continue;
      }

      try {
        const storageId = await ctx.storage.store(
          new Blob([decoded.buffer], { type: decoded.mimeType }),
        );
        const url: string | null = await ctx.runMutation(
          internal.users.migrateBase64Avatars.applyMigratedAvatar,
          { userId: candidate.userId, storageId },
        );

        if (!url) {
          // The patch never landed, so nothing references this file.
          await ctx.storage.delete(storageId);
          failed += 1;
          details.push(`FAIL ${candidate.email} — could not apply migrated avatar`);
          continue;
        }

        migrated += 1;
        bytesReclaimed += candidate.avatarUrl.length - url.length;
        details.push(
          `MIGRATED ${candidate.email} — ${candidate.avatarUrl.length}B → ${url.length}B`,
        );
      } catch (error) {
        failed += 1;
        details.push(
          `FAIL ${candidate.email} — ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    console.log(
      `[migrateBase64Avatars] dryRun=${dryRun} scanned=${candidates.length} ` +
        `migrated=${migrated} skipped=${skipped} failed=${failed} ` +
        `bytesReclaimed=${bytesReclaimed}`,
    );

    return {
      dryRun,
      scanned: candidates.length,
      migrated,
      skipped,
      failed,
      bytesReclaimed,
      details,
    };
  },
});
