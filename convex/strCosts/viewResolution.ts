// Pure resolution of a portfolioViews row into what the Monthly Close UI and
// statement export should actually use. Owner-BOUND views (ownerUserId set)
// follow users + propertyOwners live; the stored clientName/propertyIds are
// only a fallback snapshot.
//
// Self-contained (no imports) so it's unit-testable via `node --test` without
// Convex — the caller (strCosts/views.listViews) resolves the owner's client
// label via lib/ownership.resolveOwnerClient and passes it in as `ownerClient`.

export interface StoredViewFields<PropertyId extends string> {
  clientName?: string;
  propertyIds: PropertyId[];
  ownerUserId?: string;
}

export interface ResolvedViewFields<PropertyId extends string> {
  clientName: string | undefined;
  propertyIds: PropertyId[];
  isOwnerBound: boolean;
  /** Bound view whose owner has no active stakes (or user row deleted). */
  ownerLinkBroken: boolean;
}

/**
 * @param ownerClient  the bound owner's resolved statement label
 *   (company-else-name), or `null` when the bound user no longer exists.
 * @param activePropertyIds  the bound owner's current active property ids.
 */
export function resolveViewFields<PropertyId extends string>(
  view: StoredViewFields<PropertyId>,
  ownerClient: string | null,
  activePropertyIds: PropertyId[],
): ResolvedViewFields<PropertyId> {
  if (view.ownerUserId === undefined) {
    return {
      clientName: view.clientName,
      propertyIds: view.propertyIds,
      isOwnerBound: false,
      ownerLinkBroken: false,
    };
  }
  const broken = ownerClient === null || activePropertyIds.length === 0;
  return {
    clientName: ownerClient !== null ? ownerClient : view.clientName,
    propertyIds: broken ? view.propertyIds : activePropertyIds,
    isOwnerBound: true,
    ownerLinkBroken: broken,
  };
}
