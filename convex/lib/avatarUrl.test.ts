import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_AVATAR_URL_BYTES,
  isUnstorableAvatarUrl,
  sanitizeAvatarUrl,
} from "./avatarUrl.ts";

const CLERK_URL = "https://img.clerk.com/eyJ0eXBlIjoicHJveHkiLCJzcmMiOiJodHRwcz";
const CONVEX_URL =
  "https://lovable-oriole-182.convex.cloud/api/storage/3f2c1a9e-4b8d-4c7a-9e1f-2d6b8c0a5e11";

test("keeps a real Clerk avatar URL", () => {
  assert.equal(sanitizeAvatarUrl(CLERK_URL), CLERK_URL);
});

test("keeps a Convex storage URL — the URL this app now writes", () => {
  assert.equal(sanitizeAvatarUrl(CONVEX_URL), CONVEX_URL);
  assert.ok(CONVEX_URL.length < MAX_AVATAR_URL_BYTES);
});

test("trims surrounding whitespace", () => {
  assert.equal(sanitizeAvatarUrl(`  ${CLERK_URL}  `), CLERK_URL);
});

test("rejects the base64 data URI that caused the incident", () => {
  const dataUri = `data:image/jpeg;base64,${"A".repeat(240_000)}`;
  assert.equal(sanitizeAvatarUrl(dataUri), undefined);
});

test("rejects data URIs regardless of case or leading whitespace", () => {
  assert.equal(sanitizeAvatarUrl("  DATA:image/png;base64,AAAA"), undefined);
  assert.equal(sanitizeAvatarUrl("Data:image/gif;base64,AAAA"), undefined);
});

test("rejects a URL over the byte ceiling", () => {
  const long = `https://example.com/${"a".repeat(MAX_AVATAR_URL_BYTES)}`;
  assert.equal(sanitizeAvatarUrl(long), undefined);
});

test("accepts a URL exactly at the byte ceiling", () => {
  const exact = "h".repeat(MAX_AVATAR_URL_BYTES);
  assert.equal(sanitizeAvatarUrl(exact), exact);
});

test("treats absent and blank values as simply unset", () => {
  assert.equal(sanitizeAvatarUrl(undefined), undefined);
  assert.equal(sanitizeAvatarUrl(""), undefined);
  assert.equal(sanitizeAvatarUrl("   "), undefined);
});

test("isUnstorableAvatarUrl flags only stored values needing a prune", () => {
  // Bloat — must be reported.
  assert.equal(isUnstorableAvatarUrl("data:image/jpeg;base64,AAAA"), true);
  assert.equal(isUnstorableAvatarUrl("x".repeat(MAX_AVATAR_URL_BYTES + 1)), true);

  // Fine — must not be reported.
  assert.equal(isUnstorableAvatarUrl(CLERK_URL), false);
  assert.equal(isUnstorableAvatarUrl(CONVEX_URL), false);

  // Absent is not bloat. This is why it isn't just !sanitizeAvatarUrl(v).
  assert.equal(isUnstorableAvatarUrl(undefined), false);
  assert.equal(isUnstorableAvatarUrl(""), false);
  assert.equal(isUnstorableAvatarUrl("   "), false);
});
