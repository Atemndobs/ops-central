/**
 * Display-time translation for free-form room names stored in Convex (e.g.
 * "Bedroom 4", "Master Bathroom", "Living Room"). Room names are authored in
 * English (typically sourced from Hospitable) but cleaners on the PWA may use
 * Spanish. This helper renders a localized label without mutating the stored
 * value, so history/audit stays consistent across locales.
 *
 * Unknown names pass through unchanged. The intent is "best-effort polish"
 * rather than a full translation catalog.
 */

type Locale = "en" | "es" | string;

// Ordered list — longer/more specific phrases must appear before shorter ones
// so "Master Bedroom" wins over "Bedroom", etc.
const TRANSLATIONS: Array<{
  en: RegExp;
  es: string;
}> = [
  { en: /^master bedroom$/i, es: "Dormitorio principal" },
  { en: /^master bathroom$/i, es: "Baño principal" },
  { en: /^guest bedroom$/i, es: "Dormitorio de invitados" },
  { en: /^guest bathroom$/i, es: "Baño de invitados" },
  { en: /^half bath(room)?$/i, es: "Medio baño" },
  { en: /^living room$/i, es: "Sala de estar" },
  { en: /^dining room$/i, es: "Comedor" },
  { en: /^family room$/i, es: "Sala familiar" },
  { en: /^laundry( room)?$/i, es: "Lavandería" },
  { en: /^game room$/i, es: "Sala de juegos" },
  { en: /^media room$/i, es: "Sala de medios" },
  { en: /^bonus room$/i, es: "Sala extra" },
  { en: /^mud room$/i, es: "Vestíbulo" },
  { en: /^office$/i, es: "Oficina" },
  { en: /^study$/i, es: "Estudio" },
  { en: /^kitchen$/i, es: "Cocina" },
  { en: /^pantry$/i, es: "Despensa" },
  { en: /^garage$/i, es: "Garaje" },
  { en: /^basement$/i, es: "Sótano" },
  { en: /^attic$/i, es: "Ático" },
  { en: /^hallway$/i, es: "Pasillo" },
  { en: /^entrance$/i, es: "Entrada" },
  { en: /^foyer$/i, es: "Vestíbulo" },
  { en: /^balcony$/i, es: "Balcón" },
  { en: /^patio$/i, es: "Patio" },
  { en: /^backyard$/i, es: "Jardín trasero" },
  { en: /^front yard$/i, es: "Jardín delantero" },
  { en: /^pool$/i, es: "Piscina" },
  { en: /^closet$/i, es: "Armario" },
  { en: /^incident$/i, es: "Incidente" },
  { en: /^unspecified$/i, es: "Sin especificar" },
];

const NUMBERED: Array<{ en: RegExp; es: (n: string) => string }> = [
  { en: /^bedroom\s*(\d+)$/i, es: (n) => `Dormitorio ${n}` },
  { en: /^bathroom\s*(\d+)$/i, es: (n) => `Baño ${n}` },
  { en: /^bed\s*(\d+)$/i, es: (n) => `Dormitorio ${n}` },
  { en: /^bath\s*(\d+)$/i, es: (n) => `Baño ${n}` },
];

const BARE: Array<{ en: RegExp; es: string }> = [
  { en: /^bedroom$/i, es: "Dormitorio" },
  { en: /^bathroom$/i, es: "Baño" },
];

/**
 * Translate a room name to the requested locale. Returns the original string
 * if the locale isn't supported or no pattern matches.
 */
export function translateRoomDisplay(rawName: string | null | undefined, locale: Locale): string {
  if (!rawName) return "";
  const trimmed = rawName.trim();
  if (!trimmed) return "";
  if (locale !== "es") return trimmed;

  for (const entry of TRANSLATIONS) {
    if (entry.en.test(trimmed)) return entry.es;
  }
  for (const entry of NUMBERED) {
    const match = trimmed.match(entry.en);
    if (match && match[1]) return entry.es(match[1]);
  }
  for (const entry of BARE) {
    if (entry.en.test(trimmed)) return entry.es;
  }
  return trimmed;
}
