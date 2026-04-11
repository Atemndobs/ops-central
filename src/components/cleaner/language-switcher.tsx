"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { localeNames, type Locale, locales } from "@/lib/locales";

export function LanguageSwitcher() {
  const t = useTranslations();
  const router = useRouter();
  const setLocalePreference = useMutation(api.users.mutations.setLocalePreference);
  const localePreference = useQuery(api.users.queries.getLocalePreference);

  const [currentLocale, setCurrentLocale] = useState<Locale>("en");
  const [isChanging, setIsChanging] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (localePreference?.locale) {
      setCurrentLocale(localePreference.locale);
    } else if (localePreference?.role) {
      // Fallback to role-based default if no explicit preference
      setCurrentLocale(localePreference.role === "cleaner" ? "es" : "en");
    }
  }, [localePreference]);

  const handleLocaleChange = async (newLocale: Locale) => {
    if (newLocale === currentLocale || isChanging) {
      return;
    }

    setIsChanging(true);
    setMessage(null);

    try {
      await setLocalePreference({ locale: newLocale });
      setCurrentLocale(newLocale);
      setMessage({
        tone: "success",
        text: `Language changed to ${localeNames[newLocale]}`,
      });

      // Update the cookie and reload to apply new locale
      document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000`;

      // Force a page reload to apply new locale
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to change language",
      });
      setIsChanging(false);
    }
  };

  const nextLocale: Locale = currentLocale === "en" ? "es" : "en";
  const nextLocaleName = localeNames[nextLocale];

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
        onClick={() => {
          void handleLocaleChange(nextLocale);
        }}
        disabled={isChanging}
      >
        {isChanging ? "Changing..." : `Switch to ${nextLocaleName}`}
      </button>
      {message && (
        <p
          className={`rounded-md border px-3 py-2 text-sm ${
            message.tone === "success"
              ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-400"
              : "border-rose-600/30 bg-rose-500/10 text-rose-400"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
