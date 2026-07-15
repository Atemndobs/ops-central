/**
 * Avatar uploads via Convex file storage.
 *
 * WHY THIS EXISTS
 * ---------------
 * The original avatar upload base64'd the image on the client
 * (`src/lib/upload-image.ts` → `canvas.toDataURL`) and stored the whole
 * `data:image/jpeg;base64,...` string in `users.avatarUrl`. That made one user's
 * document 246 KB and `avatarUrl` 98% of the users table (279 KB of 286 KB).
 *
 * `users` is the hottest table in the app and Convex has no field projection —
 * `ctx.db.get()` reads the WHOLE document — so those bytes were re-read by
 * getByClerkId (~55k calls/mo), getMyProfile (~41k), getThemePreference (~39k),
 * and by lib/notificationLifecycle.listOpsUserIds, which reads EVERY user on
 * EVERY job write. Cost: on the order of GB/month of database reads.
 * See Docs/2026-07-14-convex-database-optimization-playbook.md (AP4: fat documents).
 *
 * THE FIX
 * -------
 * Same two-step the job photos already use (files/mutations.ts `generateUploadUrl`
 * → PUT → storageId): the bytes land in file storage, and the user document keeps
 * only the short public URL (~75 bytes). File-storage bandwidth is not database
 * I/O, so avatar reads stop counting against the database cap entirely.
 *
 * We store the resolved URL in `avatarUrl` rather than resolving a storageId at
 * read time on purpose: it leaves all ~10 existing read sites untouched, and costs
 * zero extra work per read. `avatarStorageId` is kept alongside only so a
 * re-upload can delete the file it replaces.
 */
import { v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import { type Id } from "../_generated/dataModel";
import { getCurrentUser, requireAuth, requireRole } from "../lib/auth";
import { setProfileOverride } from "../lib/profileMetadata";
import { sanitizeAvatarUrl } from "../lib/avatarUrl";

/**
 * Backend ceiling on a stored avatar file. The client compresses to 512px/0.82
 * JPEG (~30-80 KB typical) before uploading, so this is a safety net against a
 * buggy or malicious client, not the expected size.
 */
export const MAX_AVATAR_FILE_BYTES = 2 * 1024 * 1024;

const ALLOWED_AVATAR_MIMES: ReadonlyArray<string> = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

/**
 * Ticket for a direct-to-storage PUT. Authenticated so anonymous callers can't
 * mint upload URLs.
 */
export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Point a user's avatar at a freshly uploaded file.
 *
 * Validates the upload against the storage metadata (the client is not trusted to
 * report its own size/MIME), swaps the URL in, and deletes the file it replaced so
 * old avatars don't accumulate. On any validation failure the uploaded file is
 * deleted — otherwise a rejected upload would linger as an orphan forever.
 */
async function applyUploadedAvatar(
  ctx: MutationCtx,
  userId: Id<"users">,
  storageId: Id<"_storage">,
): Promise<{ avatarUrl: string }> {
  const user = await ctx.db.get(userId);
  if (!user) {
    await ctx.storage.delete(storageId);
    throw new Error("User not found.");
  }

  const metadata = await ctx.db.system.get(storageId);
  if (!metadata) {
    throw new Error("Upload not found. Please try again.");
  }

  const contentType = metadata.contentType?.toLowerCase() ?? "";
  if (!ALLOWED_AVATAR_MIMES.includes(contentType)) {
    await ctx.storage.delete(storageId);
    throw new Error(
      `Avatar must be a JPEG, PNG, or WebP image (got "${contentType || "unknown"}").`,
    );
  }
  if (metadata.size > MAX_AVATAR_FILE_BYTES) {
    await ctx.storage.delete(storageId);
    throw new Error(
      `Avatar is ${metadata.size} bytes; the ceiling is ${MAX_AVATAR_FILE_BYTES}.`,
    );
  }

  const url = await ctx.storage.getUrl(storageId);
  if (!url) {
    await ctx.storage.delete(storageId);
    throw new Error("Could not resolve the uploaded avatar. Please try again.");
  }

  // Belt and braces: the guard that keeps this field a link. A Convex storage URL
  // is ~75 bytes so this never trips — but it means there is no write path to
  // `avatarUrl` anywhere in the codebase that skips the check.
  const avatarUrl = sanitizeAvatarUrl(url);
  if (avatarUrl === undefined) {
    await ctx.storage.delete(storageId);
    throw new Error("Resolved avatar URL was not storable.");
  }

  const previousStorageId = user.avatarStorageId;

  await ctx.db.patch(userId, {
    avatarUrl,
    avatarStorageId: storageId,
    // Mark it a deliberate choice so the next Clerk sync doesn't overwrite the
    // photo the user just picked.
    metadata: setProfileOverride(user.metadata, "avatarUrl", true),
    updatedAt: Date.now(),
  });

  // Only after the patch commits the new avatar — deleting first would strand the
  // user with a broken image if the patch failed.
  if (previousStorageId && previousStorageId !== storageId) {
    await ctx.storage.delete(previousStorageId);
  }

  return { avatarUrl };
}

/** Set the calling user's own avatar. Used by the cleaner settings screen. */
export const setMyAvatar = mutation({
  args: { storageId: v.id("_storage") },
  returns: v.object({ avatarUrl: v.string() }),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    return await applyUploadedAvatar(ctx, user._id, args.storageId);
  },
});

/** Set any user's avatar. Used by the admin team page. */
export const setUserAvatar = mutation({
  args: {
    userId: v.id("users"),
    storageId: v.id("_storage"),
  },
  returns: v.object({ avatarUrl: v.string() }),
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    return await applyUploadedAvatar(ctx, args.userId, args.storageId);
  },
});
