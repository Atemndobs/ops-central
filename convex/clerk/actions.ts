import { v } from "convex/values";
import { internalAction } from "../_generated/server";

const CLERK_API_URL = "https://api.clerk.com/v1";

export const syncLocalePreferenceToClerk = internalAction({
  args: {
    clerkId: v.string(),
    locale: v.union(v.literal("en"), v.literal("es")),
  },
  handler: async (ctx, args) => {
    const clerkApiKey = process.env.CLERK_SECRET_KEY;

    if (!clerkApiKey) {
      throw new Error("CLERK_SECRET_KEY is not configured");
    }

    try {
      const response = await fetch(`${CLERK_API_URL}/users/${args.clerkId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${clerkApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          public_metadata: {
            locale: args.locale,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update Clerk user: ${response.status} ${errorText}`);
      }

      return { success: true, locale: args.locale };
    } catch (error) {
      console.error("Error syncing locale to Clerk:", error);
      throw error;
    }
  },
});

/**
 * Sync a user's role to Clerk publicMetadata + revoke active sessions so
 * the new role takes effect on the user's next request (Clerk JWT
 * embeds publicMetadata on token issuance — stale tokens carry the OLD
 * role until refresh).
 *
 * Uses the /users/{id}/metadata endpoint (vs PATCH /users/{id}) — Clerk
 * merges metadata at the key level on this endpoint, preserving locale
 * and other unrelated keys.
 *
 * Scheduled fire-and-forget by `admin/mutations:updateUser` whenever the
 * role field is patched. Mutation succeeds regardless of Clerk's response.
 */
export const syncUserRoleToClerk = internalAction({
  args: {
    clerkId: v.string(),
    role: v.string(),
  },
  handler: async (_ctx, args) => {
    const clerkApiKey = process.env.CLERK_SECRET_KEY;
    if (!clerkApiKey) {
      console.warn("[syncUserRoleToClerk] CLERK_SECRET_KEY not configured; skipping");
      return { success: false, reason: "no_clerk_key" };
    }

    // 1) Merge role into publicMetadata
    const metaRes = await fetch(
      `${CLERK_API_URL}/users/${args.clerkId}/metadata`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${clerkApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ public_metadata: { role: args.role } }),
      },
    );
    if (!metaRes.ok) {
      const body = await metaRes.text();
      throw new Error(
        `Clerk metadata PATCH failed (${metaRes.status}): ${body.slice(0, 300)}`,
      );
    }

    // 2) Revoke active sessions so the next request issues a fresh JWT
    //    with the new role claim. List → revoke per-id (Clerk has no
    //    "revoke all" endpoint for a user).
    let revoked = 0;
    let revokeErrors = 0;
    const sessionsRes = await fetch(
      `${CLERK_API_URL}/sessions?user_id=${encodeURIComponent(args.clerkId)}&status=active`,
      { headers: { Authorization: `Bearer ${clerkApiKey}` } },
    );
    if (sessionsRes.ok) {
      const sessions = (await sessionsRes.json()) as Array<{ id: string }>;
      if (Array.isArray(sessions)) {
        for (const s of sessions) {
          const rr = await fetch(`${CLERK_API_URL}/sessions/${s.id}/revoke`, {
            method: "POST",
            headers: { Authorization: `Bearer ${clerkApiKey}` },
          });
          if (rr.ok) revoked += 1;
          else revokeErrors += 1;
        }
      }
    }

    return { success: true, role: args.role, revoked, revokeErrors };
  },
});
