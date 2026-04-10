export function getErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
) {
  // ConvexError stores the user-facing message in `.data`
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    typeof (error as { data: unknown }).data === "string" &&
    (error as { data: string }).data.trim()
  ) {
    return (error as { data: string }).data;
  }

  if (error instanceof Error && error.message) {
    // Strip Convex internal prefixes like "[CONVEX Mmodule/func] [Request ID: ...] Server Error Uncaught ConvexError: "
    const convexPrefix = /^\[CONVEX\s[\s\S]*?(?:ConvexError|Error):\s*/;
    const cleaned = error.message.replace(convexPrefix, "");
    // Strip trailing stack traces (lines starting with "at ")
    const withoutStack = cleaned.replace(/\s+at\s+\S+[\s\S]*$/, "").trim();
    return withoutStack || error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}
