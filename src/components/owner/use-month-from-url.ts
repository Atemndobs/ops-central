"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { currentMonthKey } from "./month-switcher";

/**
 * Reads `?month=YYYY-MM` from the URL (defaults to current month) and
 * returns a setter that updates it via `router.replace` (no history
 * pollution). Used by the dashboard + per-property page so the month
 * context persists across drill-ins, browser back/forward, and shared
 * deep-links.
 */
export function useMonthFromUrl(): [string, (next: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const month = params.get("month") ?? currentMonthKey();

  const setMonth = useCallback(
    (next: string) => {
      const sp = new URLSearchParams(params.toString());
      if (next === currentMonthKey()) {
        sp.delete("month");
      } else {
        sp.set("month", next);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, params],
  );

  return [month, setMonth];
}
