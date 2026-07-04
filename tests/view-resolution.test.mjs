import { describe, it } from "node:test";
import assert from "node:assert";
import { resolveViewFields } from "../convex/strCosts/viewResolution.ts";

describe("resolveViewFields", () => {
  const stored = { clientName: "Custom Label", propertyIds: ["p1", "p2"] };

  it("passes stored fields through for unbound views", () => {
    assert.deepStrictEqual(resolveViewFields(stored, null, []), {
      clientName: "Custom Label",
      propertyIds: ["p1", "p2"],
      isOwnerBound: false,
      ownerLinkBroken: false,
    });
  });

  it("derives client + properties live from the owner for bound views", () => {
    const r = resolveViewFields(
      { ...stored, ownerUserId: "u1" },
      "Lisboa Holdings",
      ["p9"],
    );
    assert.strictEqual(r.clientName, "Lisboa Holdings");
    assert.deepStrictEqual(r.propertyIds, ["p9"]);
    assert.strictEqual(r.isOwnerBound, true);
    assert.strictEqual(r.ownerLinkBroken, false);
  });

  it("falls back to the stored properties when the owner has no active stakes", () => {
    const r = resolveViewFields({ ...stored, ownerUserId: "u1" }, "Tataw John", []);
    // Client still follows the live owner label; property list falls back.
    assert.strictEqual(r.clientName, "Tataw John");
    assert.deepStrictEqual(r.propertyIds, ["p1", "p2"]);
    assert.strictEqual(r.ownerLinkBroken, true);
  });

  it("falls back entirely when the owner user record is missing", () => {
    const r = resolveViewFields({ ...stored, ownerUserId: "u1" }, null, []);
    assert.strictEqual(r.clientName, "Custom Label");
    assert.deepStrictEqual(r.propertyIds, ["p1", "p2"]);
    assert.strictEqual(r.ownerLinkBroken, true);
  });
});
