export function getErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}
