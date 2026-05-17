// Per R7.4 (manager-scope task, 2026-05-17): approval rights are
// admin + property_ops only. Managers do NOT approve cleaner submissions;
// they dispatch and supervise within their own company but the approval
// gate is held by ops/admin.
//
// Prior to 2026-05-17 this allowed {property_ops, manager} and locked
// admin out — that older shape is preserved in git history.
export function isReviewerRole(role: string): boolean {
  return role === "admin" || role === "property_ops";
}

export function assertReviewerRole(role: string): void {
  if (!isReviewerRole(role)) {
    throw new Error("Reviewer-only query.");
  }
}
