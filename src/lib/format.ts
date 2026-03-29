/** Convert a snake_case string to Title Case (e.g. "missing_item" → "Missing Item"). */
export function formatLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
