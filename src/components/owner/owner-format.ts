// Tiny shared formatters for owner-portal screens.

import { formatDate } from "@/lib/tz";

export function fmtMoney(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function fmtDate(ms: number): string {
  return formatDate(ms, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtMonth(monthKey: string): string {
  // "2026-05" → "May 2026"
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Short month + zero-padded day, no year — e.g. "May 08". Used by the
 * mortgage coverage subtitle so the line fits the mobile frame.
 */
export function fmtMonthDayPadded(ms: number): string {
  return formatDate(ms, {
    month: "short",
    day: "2-digit",
  });
}

/**
 * Just the short month name from a "YYYY-MM" key — e.g. "2026-05" → "May".
 * Year is dropped intentionally (used in copy where "Your May Mortgage…"
 * implies the current period without needing the year stamp).
 */
export function fmtShortMonth(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Compact American MM/DD/YY for narrow columns (mobile bookings table, etc.).
 * Example: 1747958400000 → "05/22/26"
 */
export function fmtDateShort(ms: number): string {
  return formatDate(ms, {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}

/**
 * Boost Airbnb CDN image quality from the default `aki_policy=large` to
 * `x_large` so hero/thumbnail images aren't blurry. Pass-through for other
 * URLs.
 */
export function upgradeAirbnbImageQuality(url: string): string {
  return url.includes("aki_policy=")
    ? url.replace(/aki_policy=[^&]+/, "aki_policy=x_large")
    : url;
}

export function bucketLabel(bucket: string): string {
  const labels: Record<string, string> = {
    lease: "Lease / Rent",
    cleaning: "Cleaning",
    supplies: "Supplies & Restocks",
    utilities: "Utilities",
    maintenance: "Maintenance & Repairs",
    lawnPoolOutdoor: "Lawn / Pool / Outdoor",
    platformFees: "Platform Fees",
    subscriptions: "Software & Subscriptions",
    labor: "Labor & Contractors",
    insurance: "Insurance",
    taxes: "Taxes",
    managementFee: "Management Fee",
    other: "Other / Adjustments",
  };
  return labels[bucket] ?? bucket;
}
