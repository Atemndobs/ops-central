// Tiny shared formatters for owner-portal screens.

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
  return new Date(ms).toLocaleDateString("en-US", {
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
