"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useTimezone } from "@/components/providers/timezone-provider";
import { formatTimeInZone, timezoneAbbrev, timezoneLabel } from "@/lib/tz";

/**
 * Live clock badge showing the current time in the app's display timezone,
 * so it's always clear which zone the dashboard's dates/times are in.
 */
export function TimezoneClock({ className = "" }: { className?: string }) {
  const { timezone } = useTimezone();
  // Start null to avoid an SSR/client hydration mismatch; fill in on mount.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now
    ? formatTimeInZone(now, timezone, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--";

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border bg-[var(--card)] px-3 py-1 text-xs ${className}`}
      title={`Times shown in ${timezoneLabel(timezone)} (${timezone})`}
    >
      <Clock className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
      <span className="font-mono font-semibold tabular-nums">{time}</span>
      <span className="text-[var(--muted-foreground)]">
        {now ? `${timezoneAbbrev(timezone, now)} · ` : ""}
        {timezoneLabel(timezone)}
      </span>
    </div>
  );
}
