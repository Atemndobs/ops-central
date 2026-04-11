// Client-safe locale configuration (no server-only imports)
export type Locale = "en" | "es";

export const locales: Locale[] = ["en", "es"];
export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

export const roleDefaultLocale: Record<string, Locale> = {
  admin: "en",
  property_ops: "en",
  manager: "en",
  cleaner: "es",
};
