"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_TIMEZONE, isValidTimeZone, setDefaultTimezone } from "@/lib/tz";

const STORAGE_KEY = "opscentral.timezone";

type TimezoneContextValue = {
  /** The app default display timezone (per-device, from Settings). */
  timezone: string;
  setTimezone: (tz: string) => void;
};

const TimezoneContext = createContext<TimezoneContextValue>({
  timezone: DEFAULT_TIMEZONE,
  setTimezone: () => {},
});

/**
 * Per-device timezone store (localStorage), mirroring the mobile app's
 * TimezoneContext. Keeps the `lib/tz` module singleton in sync so pure
 * formatters resolve the app default without prop-drilling. Remounts children
 * on change (via `key`) so every formatted value re-renders in the new zone.
 */
export function TimezoneProvider({ children }: { children: React.ReactNode }) {
  const [timezone, setTz] = useState(DEFAULT_TIMEZONE);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && isValidTimeZone(saved)) {
        setDefaultTimezone(saved);
        setTz(saved);
      }
    } catch {
      /* ignore private-mode / quota */
    }
  }, []);

  const setTimezone = (tz: string) => {
    if (!isValidTimeZone(tz)) return;
    setDefaultTimezone(tz);
    setTz(tz);
    try {
      window.localStorage.setItem(STORAGE_KEY, tz);
    } catch {
      /* ignore */
    }
  };

  return (
    <TimezoneContext.Provider value={{ timezone, setTimezone }} key={timezone}>
      {children}
    </TimezoneContext.Provider>
  );
}

export function useTimezone(): TimezoneContextValue {
  return useContext(TimezoneContext);
}
