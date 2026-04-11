import { type Locale } from "@/i18n";

/**
 * Format a date in the user's locale
 */
export function formatDate(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;

  return new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

/**
 * Format a time in the user's locale
 */
export function formatTime(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;

  return new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/**
 * Format a date and time in the user's locale
 */
export function formatDateTime(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;

  return new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/**
 * Format a number in the user's locale
 */
export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(locale === "es" ? "es-ES" : "en-US", options).format(value);
}

/**
 * Format currency in the user's locale
 */
export function formatCurrency(
  value: number,
  locale: Locale,
  currency: string = "USD"
): string {
  return new Intl.NumberFormat(locale === "es" ? "es-ES" : "en-US", {
    style: "currency",
    currency,
  }).format(value);
}

/**
 * Status text with localization support
 */
export const statusLabels: Record<string, Record<Locale, string>> = {
  scheduled: {
    en: "Scheduled",
    es: "Programado",
  },
  assigned: {
    en: "Assigned",
    es: "Asignado",
  },
  in_progress: {
    en: "In Progress",
    es: "En Progreso",
  },
  completed: {
    en: "Completed",
    es: "Completado",
  },
  approved: {
    en: "Approved",
    es: "Aprobado",
  },
  failed: {
    en: "Failed",
    es: "Fallido",
  },
  rework: {
    en: "Rework",
    es: "Rehacer",
  },
};

/**
 * Get status label for a given locale
 */
export function getStatusLabel(status: string, locale: Locale): string {
  return statusLabels[status]?.[locale] || status;
}

/**
 * Role display names
 */
export const roleLabels: Record<string, Record<Locale, string>> = {
  admin: {
    en: "Admin",
    es: "Administrador",
  },
  property_ops: {
    en: "Property Operations",
    es: "Operaciones de Propiedades",
  },
  manager: {
    en: "Manager",
    es: "Gerente",
  },
  cleaner: {
    en: "Cleaner",
    es: "Limpiador",
  },
};

/**
 * Get role label for a given locale
 */
export function getRoleLabel(role: string, locale: Locale): string {
  return roleLabels[role]?.[locale] || role;
}
