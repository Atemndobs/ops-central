"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Clock, Timer } from "lucide-react";

type JobCountdownProps = {
  scheduledStartAt?: number | null;
  actualStartAt?: number | null;
  actualEndAt?: number | null;
  status: string;
};

function computeCountdown(scheduledStartAt: number, now: number) {
  const diff = scheduledStartAt - now;

  if (diff <= 0) {
    return { text: "Now", color: "text-blue-400", icon: "clock" as const };
  }

  const totalMinutes = Math.floor(diff / 60_000);
  const totalHours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (days >= 1) {
    return {
      text: `${days}d`,
      color: "text-[var(--muted-foreground)]",
      icon: "calendar" as const,
    };
  }

  // Under 24h — show live hours:minutes countdown
  const hours = totalHours;
  const minutes = totalMinutes % 60;

  if (hours >= 1) {
    const color = hours <= 2 ? "text-amber-400" : "text-blue-400";
    return {
      text: `${hours}h ${minutes.toString().padStart(2, "0")}m`,
      color,
      icon: "clock" as const,
    };
  }

  // Under 1 hour — red, show minutes:seconds
  const seconds = Math.floor((diff / 1000) % 60);
  return {
    text: `${minutes}m ${seconds.toString().padStart(2, "0")}s`,
    color: "text-red-400",
    icon: "clock" as const,
  };
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((chunk) => chunk.toString().padStart(2, "0"))
    .join(":");
}

export function JobCountdown({
  scheduledStartAt,
  actualStartAt,
  actualEndAt,
  status,
}: JobCountdownProps) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    // Determine tick rate:
    // - In-progress jobs (active timer): every second
    // - Within 24h of start: every second (live countdown)
    // - Otherwise: every 60s (just tracking days)
    const isInProgress = status === "in_progress" && actualStartAt && !actualEndAt;
    const msUntilStart = (scheduledStartAt ?? 0) - Date.now();
    const withinDay = msUntilStart > 0 && msUntilStart < 86_400_000;

    const interval = isInProgress || withinDay ? 1_000 : 60_000;

    const id = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(id);
  }, [status, actualStartAt, actualEndAt, scheduledStartAt]);

  // In-progress jobs: show elapsed timer
  if (status === "in_progress" && actualStartAt) {
    const elapsed = Math.max(0, (actualEndAt ?? now) - actualStartAt);
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-emerald-400">
        <Timer className="h-3.5 w-3.5 animate-pulse" />
        {formatElapsed(elapsed)}
      </span>
    );
  }

  // No scheduled time
  if (!scheduledStartAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <CalendarDays className="h-3.5 w-3.5" />
        TBD
      </span>
    );
  }

  // Completed / past jobs: no countdown needed
  if (status === "completed" || status === "cancelled") {
    return null;
  }

  const countdown = computeCountdown(scheduledStartAt, now);
  const Icon = countdown.icon === "calendar" ? CalendarDays : Clock;

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${countdown.color}`}>
      <Icon className="h-3.5 w-3.5" />
      {countdown.text}
    </span>
  );
}
