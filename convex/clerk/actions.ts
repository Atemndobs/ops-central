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
