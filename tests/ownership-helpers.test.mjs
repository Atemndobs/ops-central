import { describe, it } from "node:test";
import assert from "node:assert";
import {
  filterActiveOwnerships,
  groupActiveByUser,
  resolveOwnerClient,
} from "../convex/lib/ownership.ts";

describe("filterActiveOwnerships", () => {
  it("keeps only rows with effectiveTo === undefined", () => {
    const rows = [
      { userId: "u1", propertyId: "p1" },
      { userId: "u1", propertyId: "p2", effectiveTo: 123 },
    ];
    assert.deepStrictEqual(filterActiveOwnerships(rows), [rows[0]]);
  });
});

describe("groupActiveByUser", () => {
  it("groups active rows by userId and drops closed rows", () => {
    const rows = [
      { userId: "u1", propertyId: "p1" },
      { userId: "u1", propertyId: "p2" },
      { userId: "u2", propertyId: "p3", effectiveTo: 1 },
    ];
    const map = groupActiveByUser(rows);
    assert.strictEqual(map.get("u1").length, 2);
    assert.strictEqual(map.has("u2"), false);
  });
});

describe("resolveOwnerClient", () => {
  it("prefers trimmed company, then name, then email, then placeholder", () => {
    assert.strictEqual(
      resolveOwnerClient({ company: " Acme LLC ", name: "Bob" }),
      "Acme LLC",
    );
    assert.strictEqual(resolveOwnerClient({ company: "  ", name: "Bob" }), "Bob");
    assert.strictEqual(resolveOwnerClient({ email: "b@x.com" }), "b@x.com");
    assert.strictEqual(resolveOwnerClient({}), "(unnamed owner)");
  });
});
