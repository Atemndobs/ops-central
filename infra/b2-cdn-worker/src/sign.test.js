// Guards the CDN token scheme shared by the Cloudflare Worker (src/worker.ts)
// and the Convex backend (convex/lib/externalStorage.ts → signCdnReadUrl).
// Both sign HMAC-SHA256 over `${objectKey}\n${exp}` and encode base64url with no
// padding. This asserts that WebCrypto+btoa encoding (what both use) matches the
// canonical node:crypto base64url, so the two implementations can't drift.
//
// Run: node --test infra/b2-cdn-worker/src/sign.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

function toBase64UrlFromBytes(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacWebCrypto(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return toBase64UrlFromBytes(new Uint8Array(mac));
}

const hmacNodeCanonical = (secret, message) =>
  createHmac("sha256", secret).update(message).digest("base64url");

const VECTORS = [
  ["s3cr3t-signing-key", "jobs/abc123/after/1783705827282-photo.jpg", 2000000000],
  ["another-secret", "jobs/x/incident/é spaced/name.jpg", 1783705827],
  ["k", "a", 1],
];

test("WebCrypto base64url HMAC (worker + convex) == canonical node base64url", async () => {
  for (const [secret, objectKey, exp] of VECTORS) {
    const message = `${objectKey}\n${exp}`;
    assert.equal(
      await hmacWebCrypto(secret, message),
      hmacNodeCanonical(secret, message),
      `mismatch for key=${objectKey}`,
    );
  }
});

test("signature is url-safe base64 with no padding", async () => {
  const sig = await hmacWebCrypto("secret", "jobs/x/after/1.jpg\n1783705827");
  assert.match(sig, /^[A-Za-z0-9_-]+$/);
  assert.ok(!sig.includes("="), "must not contain padding");
});

test("a tampered expiry produces a different signature", async () => {
  const a = await hmacWebCrypto("secret", "jobs/x/after/1.jpg\n1000");
  const b = await hmacWebCrypto("secret", "jobs/x/after/1.jpg\n1001");
  assert.notEqual(a, b);
});
