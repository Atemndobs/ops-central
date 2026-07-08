// Shared contract for SearchableSelect. This file is duplicated verbatim in
// apps-ja/jna-cleaners-app/components/ui/searchable-select/contract.ts.
// CI check: scripts/verify-searchable-select-contract.sh diffs the two copies.

export type SearchableSelectItem<Meta = unknown> = {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  disabled?: boolean;
  meta?: Meta;
};

export type SearchableSelectProps<Meta = unknown> = {
  items: SearchableSelectItem<Meta>[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loading?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  groupOrder?: string[];
  id?: string;
  name?: string;
  "aria-label"?: string;
};

export function filterSearchableItems<M>(
  items: SearchableSelectItem<M>[],
  query: string,
): SearchableSelectItem<M>[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const label = item.label.toLowerCase();
    const hint = item.hint?.toLowerCase() ?? "";
    const group = item.group?.toLowerCase() ?? "";
    return label.includes(q) || hint.includes(q) || group.includes(q);
  });
}

export function groupSearchableItems<M>(
  items: SearchableSelectItem<M>[],
  groupOrder?: string[],
): Array<{ group: string | null; items: SearchableSelectItem<M>[] }> {
  const buckets = new Map<string | null, SearchableSelectItem<M>[]>();
  for (const item of items) {
    const key = item.group ?? null;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const keys = Array.from(buckets.keys());
  if (groupOrder) {
    keys.sort((a, b) => {
      const ai = a === null ? Number.MAX_SAFE_INTEGER : groupOrder.indexOf(a);
      const bi = b === null ? Number.MAX_SAFE_INTEGER : groupOrder.indexOf(b);
      return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) -
        (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
    });
  }
  return keys.map((group) => ({ group, items: buckets.get(group)! }));
}
