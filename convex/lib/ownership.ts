// Pure helpers over `propertyOwners` rows and owner users. Shared by
// admin/queries.getTeamMetrics, admin/ownerOverview.listOwners and
// strCosts/views.* so every surface answers "who owns what" and "what
// prints on a statement" identically.
//
// An ownership row is ACTIVE iff `effectiveTo === undefined` (closed rows
// keep their close timestamp — the table is append-only / time-versioned).

export interface OwnershipLike {
  userId: string;
  propertyId: string;
  effectiveTo?: number;
}

export function filterActiveOwnerships<T extends OwnershipLike>(rows: T[]): T[] {
  return rows.filter((o) => o.effectiveTo === undefined);
}

export function groupActiveByUser<T extends OwnershipLike>(
  rows: T[],
): Map<string, T[]> {
  const byUser = new Map<string, T[]>();
  for (const o of filterActiveOwnerships(rows)) {
    const list = byUser.get(o.userId) ?? [];
    list.push(o);
    byUser.set(o.userId, list);
  }
  return byUser;
}

export interface ClientNameSource {
  name?: string | null;
  email?: string | null;
  company?: string | null;
}

/** What prints on a statement: company if set (trimmed), else name, else email. */
export function resolveOwnerClient(user: ClientNameSource): string {
  const company = user.company?.trim();
  if (company) return company;
  return user.name ?? user.email ?? "(unnamed owner)";
}
