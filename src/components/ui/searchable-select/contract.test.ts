import test from "node:test";
import assert from "node:assert/strict";

import {
  filterSearchableItems,
  groupSearchableItems,
  type SearchableSelectItem,
} from "./contract.ts";

function make(
  id: string,
  label: string,
  group?: string,
  hint?: string,
): SearchableSelectItem {
  return { id, label, group, hint };
}

const INVENTORY: SearchableSelectItem[] = [
  make("1", "Toilet paper (30 rolls)", "All Bathrooms", "SKU-1001"),
  make("2", "Bath towels 12 (4-pack)", "All Bathrooms"),
  make("3", "Queen Pillows", "Bedroom 1"),
  make("4", "Queen Comforter", "Bedroom 1"),
  make("5", "Wine Glass (8)", "Kitchen"),
  make("6", "Dinnerware Set", "Kitchen", "navy blue"),
  make("7", "Ungrouped widget"),
];

test("filterSearchableItems returns all items for empty query", () => {
  assert.equal(filterSearchableItems(INVENTORY, "").length, INVENTORY.length);
  assert.equal(filterSearchableItems(INVENTORY, "   ").length, INVENTORY.length);
});

test("filterSearchableItems matches label case-insensitively", () => {
  const out = filterSearchableItems(INVENTORY, "TOILET");
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "1");
});

test("filterSearchableItems matches hint", () => {
  const out = filterSearchableItems(INVENTORY, "sku-1001");
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "1");
});

test("filterSearchableItems matches group heading", () => {
  const out = filterSearchableItems(INVENTORY, "bedroom");
  assert.deepEqual(
    out.map((i) => i.id),
    ["3", "4"],
  );
});

test("filterSearchableItems returns empty array when nothing matches", () => {
  assert.deepEqual(filterSearchableItems(INVENTORY, "zzzz"), []);
});

test("filterSearchableItems preserves input order (no re-sorting)", () => {
  const out = filterSearchableItems(INVENTORY, "queen");
  assert.deepEqual(
    out.map((i) => i.id),
    ["3", "4"],
  );
});

test("groupSearchableItems buckets by group, preserves input order within bucket", () => {
  const grouped = groupSearchableItems(INVENTORY);
  assert.equal(grouped.length, 4); // All Bathrooms, Bedroom 1, Kitchen, ungrouped
  const bathrooms = grouped.find((g) => g.group === "All Bathrooms");
  assert.ok(bathrooms);
  assert.deepEqual(
    bathrooms!.items.map((i) => i.id),
    ["1", "2"],
  );
});

test("groupSearchableItems puts ungrouped items under null key", () => {
  const grouped = groupSearchableItems(INVENTORY);
  const ungrouped = grouped.find((g) => g.group === null);
  assert.ok(ungrouped);
  assert.deepEqual(
    ungrouped!.items.map((i) => i.id),
    ["7"],
  );
});

test("groupSearchableItems respects groupOrder when provided", () => {
  const grouped = groupSearchableItems(INVENTORY, [
    "Kitchen",
    "Bedroom 1",
    "All Bathrooms",
  ]);
  assert.deepEqual(
    grouped.map((g) => g.group),
    ["Kitchen", "Bedroom 1", "All Bathrooms", null],
  );
});

test("groupSearchableItems puts unknown groups after the explicit order", () => {
  const grouped = groupSearchableItems(INVENTORY, ["Bedroom 1"]);
  // Bedroom 1 first, then remaining buckets in input order
  assert.equal(grouped[0].group, "Bedroom 1");
});

test("filter + group composes for typical render pipeline", () => {
  const filtered = filterSearchableItems(INVENTORY, "queen");
  const grouped = groupSearchableItems(filtered);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].group, "Bedroom 1");
  assert.equal(grouped[0].items.length, 2);
});

test("handles a 2k-item list under 50ms (perf guard)", () => {
  const big: SearchableSelectItem[] = [];
  for (let i = 0; i < 2000; i += 1) {
    big.push(make(`${i}`, `Item ${i}`, `Room ${i % 20}`));
  }
  const started = performance.now();
  const out = filterSearchableItems(big, "1234");
  const elapsed = performance.now() - started;
  assert.ok(out.length >= 1);
  assert.ok(
    elapsed < 50,
    `filter took ${elapsed.toFixed(1)}ms, budget is 50ms`,
  );
});
