/**
 * Platform logos — official brand marks from `simple-icons` (CC0-1.0 / public
 * domain), tree-shaken so only the platforms we actually render get bundled.
 *
 * Same set of platforms our Hospitable webhook normalises into
 * `stays.platform`: airbnb, vrbo (HomeAway is the legacy name for VRBO and
 * shares the brand), bookingdotcom, plus a fallback for unknown / direct.
 *
 * Each entry exposes:
 *   - title       — official brand title (used as alt + tooltip)
 *   - hex         — official brand background colour (no `#`)
 *   - pathD       — SVG `d` attribute for the brand mark, rendered in white
 *                   on a brand-coloured circle for legibility at small sizes
 */

"use client";

import { siAirbnb, siBookingdotcom } from "simple-icons";
import { Globe } from "lucide-react";

type Entry = { title: string; hex: string; pathD: string };

/** Normalise the incoming `stays.platform` string to a stable key. */
function normalisePlatform(raw: string): "airbnb" | "vrbo" | "bookingdotcom" | "direct" {
  const k = raw.toLowerCase();
  if (k.includes("airbnb")) return "airbnb";
  if (k.includes("vrbo") || k.includes("homeaway")) return "vrbo";
  if (k.includes("booking")) return "bookingdotcom";
  return "direct";
}

// Airbnb + Booking.com come from `simple-icons` (CC0). VRBO is not in the
// package — fall back to a wordmark chip in the official VRBO blue.
const BRANDS = {
  airbnb: { title: siAirbnb.title, hex: siAirbnb.hex, pathD: siAirbnb.path },
  bookingdotcom: {
    title: siBookingdotcom.title,
    hex: siBookingdotcom.hex,
    pathD: siBookingdotcom.path,
  },
} satisfies Record<string, Entry>;

const VRBO_BRAND_HEX = "245ABC";

/**
 * Compact circular brand-coloured chip with the official monochrome
 * brand mark in white. Same footprint as the previous monogram chip
 * (h-4 w-4) so layouts don't shift.
 */
export function PlatformLogo({
  platform,
  size = 16,
}: {
  platform: string;
  size?: number;
}) {
  const key = normalisePlatform(platform);
  if (key === "direct") {
    return (
      <span
        aria-label="Direct booking"
        title="Direct booking"
        className="inline-flex items-center justify-center rounded-full text-white"
        style={{
          width: size,
          height: size,
          background: "var(--cleaner-primary)",
        }}
      >
        <Globe size={Math.round(size * 0.65)} />
      </span>
    );
  }
  if (key === "vrbo") {
    // VRBO isn't in simple-icons; render a wordmark chip in their
    // official blue. Larger pill width to fit the 4-letter mark.
    return (
      <span
        aria-label="Vrbo"
        title="Vrbo"
        className="inline-flex shrink-0 items-center justify-center rounded-full px-1.5 font-bold uppercase tracking-tight text-white"
        style={{
          height: size,
          background: `#${VRBO_BRAND_HEX}`,
          fontSize: Math.round(size * 0.55),
          letterSpacing: "0.02em",
          fontFamily: "var(--font-cleaner-body, system-ui)",
        }}
      >
        vrbo
      </span>
    );
  }
  const entry = BRANDS[key];
  // Inner mark inset so it doesn't touch the edge of the chip.
  const inner = Math.round(size * 0.66);
  return (
    <span
      aria-label={entry.title}
      title={entry.title}
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `#${entry.hex}`,
      }}
    >
      <svg
        role="img"
        viewBox="0 0 24 24"
        width={inner}
        height={inner}
        aria-hidden
        fill="#fff"
      >
        <path d={entry.pathD} />
      </svg>
    </span>
  );
}

/** Human-readable display name for a platform key — keeps the per-component
 *  label consistent with what the brand officially calls itself. */
export function platformDisplayName(platform: string): string {
  const key = normalisePlatform(platform);
  if (key === "direct") return "Direct";
  if (key === "vrbo") return "Vrbo";
  return BRANDS[key].title;
}
