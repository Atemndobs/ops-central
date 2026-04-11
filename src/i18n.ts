import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { locales, defaultLocale, roleDefaultLocale, type Locale } from "@/lib/locales";

// Re-export for backwards compatibility
export { locales, defaultLocale, roleDefaultLocale, type Locale } from "@/lib/locales";

// Import dictionaries dynamically
const dictionaries: Record<Locale, () => Promise<any>> = {
  en: () => import("./messages/en.json").then((module) => module.default),
  es: () => import("./messages/es.json").then((module) => module.default),
};

/**
 * Resolve the user's preferred locale based on:
 * 1. Explicitly saved user preference (Convex + Clerk)
 * 2. Cookie-stored locale preference
 * 3. Role-based default (from Clerk metadata)
 * 4. Fallback to app default (English)
 */
export async function getLocaleFromRequest(
  clerkUserId?: string,
  userRole?: string
): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value as Locale | undefined;

  if (cookieLocale && locales.includes(cookieLocale)) {
    return cookieLocale;
  }

  if (userRole && userRole in roleDefaultLocale) {
    return roleDefaultLocale[userRole];
  }

  return defaultLocale;
}

export default getRequestConfig(async () => {
  // This runs on the server for each request
  // Resolve locale based on: saved preference → cookie → role → default

  let locale: Locale = defaultLocale;
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value as Locale | undefined;

  try {
    // Try to get authenticated user and their saved preference
    const { userId } = await auth();

    if (userId) {
      const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
      if (convexUrl) {
        try {
          const convex = new ConvexHttpClient(convexUrl);
          const userPreference = await convex.query(api.users.queries.getLocalePreference);

          if (userPreference?.locale && locales.includes(userPreference.locale)) {
            // Preference 1: Saved user preference from Convex (highest priority)
            locale = userPreference.locale;
          } else if (cookieLocale && locales.includes(cookieLocale)) {
            // Preference 2: Cookie-stored preference
            locale = cookieLocale;
          } else if (userPreference?.role && userPreference.role in roleDefaultLocale) {
            // Preference 3: Role-based default
            locale = roleDefaultLocale[userPreference.role];
          }
        } catch (error) {
          console.warn("Failed to fetch locale preference from Convex:", error);
          // Fall back to cookie or role-based default
          if (cookieLocale && locales.includes(cookieLocale)) {
            locale = cookieLocale;
          }
        }
      }
    } else if (cookieLocale && locales.includes(cookieLocale)) {
      // For unauthenticated users, use cookie if available
      locale = cookieLocale;
    }
  } catch (error) {
    console.warn("Failed to get auth context:", error);
    // Fall back to cookie or default
    if (cookieLocale && locales.includes(cookieLocale)) {
      locale = cookieLocale;
    }
  }

  return {
    locale,
    messages: await dictionaries[locale](),
  };
});
