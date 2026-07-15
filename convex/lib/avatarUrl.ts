/**
 * Guard for `users.avatarUrl`: it must stay a *link*, never an embedded image.
 *
 * WHY
 * ---
 * `users` is the hottest table in the app and Convex has no field projection —
 * `ctx.db.get()` always reads the WHOLE document. So anything parked in this field
 * is re-read by getByClerkId (~55k calls/mo), getMyProfile (~41k),
 * getThemePreference (~39k), getByRole, getAllUsers, and by
 * lib/notificationLifecycle.listOpsUserIds, which reads EVERY user on EVERY job
 * write.
 *
 * Measured 2026-07-15 (`csoi perf --docs`): three accounts held
 * `data:image/jpeg;base64,...` avatars — one at 246 KB — making `avatarUrl` 98% of
 * the users table (279 KB of 286 KB) and costing on the order of GB/month in reads.
 * See Docs/2026-07-14-convex-database-optimization-playbook.md (AP4: fat documents).
 *
 * This module is deliberately import-free so it can be unit-tested directly under
 * `node --test` type-stripping — see Docs/csoi-cli.md and the convex test
 * convention. Keep it that way.
 */

/**
 * Upper bound on a stored avatar URL. Real ones are short — Clerk serves
 * `https://img.clerk.com/...` at ~150-180 bytes. 512 leaves generous headroom for
 * query strings while still being ~500x smaller than the blob that caused the
 * incident.
 */
export const MAX_AVATAR_URL_BYTES = 512;

/**
 * Normalize an incoming avatar URL, or return `undefined` if it isn't storable.
 *
 * Rejects `data:` URIs (embedded image payloads — the exact thing that bloated the
 * table) and anything over MAX_AVATAR_URL_BYTES.
 *
 * Returning `undefined` rather than throwing is deliberate for the *sync* paths: a
 * bad avatar must never block a login or a Clerk webhook. The user simply keeps no
 * stored avatar, and the next Clerk sync writes the proper short URL, so it
 * self-heals. Interactive paths (an admin typing a URL into a form) should check for
 * `undefined` and raise their own error instead of silently dropping the input.
 */
export function sanitizeAvatarUrl(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (/^data:/i.test(trimmed)) return undefined;
  if (trimmed.length > MAX_AVATAR_URL_BYTES) return undefined;
  return trimmed;
}

/**
 * True when a *stored* value is one we'd no longer accept — i.e. it predates the
 * guard above and should be pruned. Note this is not simply `!sanitizeAvatarUrl(v)`:
 * an absent avatar is fine and must not be reported as bloat.
 */
export function isUnstorableAvatarUrl(value: string | undefined): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  return sanitizeAvatarUrl(value) === undefined;
}
