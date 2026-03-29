export function isReviewerRole(role: string): boolean {
  return role === "property_ops" || role === "manager";
}

export function assertReviewerRole(role: string): void {
  if (!isReviewerRole(role)) {
    throw new Error("Reviewer-only query.");
  }
}

