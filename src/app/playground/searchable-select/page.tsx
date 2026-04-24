"use client";

import { useState } from "react";

import { SearchableSelect } from "@/components/ui/searchable-select";
import type { SearchableSelectItem } from "@/components/ui/searchable-select";

const ROOMS = [
  "All Bathrooms",
  "Bedroom 1",
  "Bedroom 2",
  "Kitchen",
  "Living Room",
  "Bathroom 1",
];

function fakeInventory(count: number): SearchableSelectItem[] {
  const names = [
    "Toilet paper (30 rolls)",
    "Bath towels 12 (4-pack)",
    "Hand towels 12 (6-pack)",
    "Face towels 24",
    "Set Shampoo, Conditioner, Body Wash",
    "Small Trashbags (Pack of 3)",
    "Shampoo",
    "Conditioner",
    "Towels (24)",
    "Q-Tip Jars (Set of 3)",
    "Hairdryer",
    "Mattress Protector Queen",
    "Queen Pillows — 6 total",
    "Queen Comforter",
    "Queen Sheet Set 4-piece",
    "Side Tables charcoal (2)",
    "Area Rug blue oriental pattern 8x10'",
    "Throw Blanket, blue",
    "Wall Art, silver spikes",
    "Curtains, 42x84\", velvet, light blue",
    "Wine Glass (8)",
    "Simple Water Glass (12)",
    "Table Set — Navy (6)",
    "Dinnerware Set for 6",
    "Frying Pan",
    "Coffee Maker",
  ];
  const out: SearchableSelectItem[] = [];
  for (let i = 0; i < count; i += 1) {
    const name = names[i % names.length];
    const room = ROOMS[i % ROOMS.length];
    out.push({
      id: `item-${i}`,
      label: i > names.length ? `${name} #${i}` : name,
      group: room,
      hint: i % 3 === 0 ? `SKU-${1000 + i}` : undefined,
    });
  }
  return out;
}

export default function Playground() {
  const [small, setSmall] = useState<string | null>(null);
  const [medium, setMedium] = useState<string | null>(null);
  const [large, setLarge] = useState<string | null>(null);

  const items10 = fakeInventory(10);
  const items100 = fakeInventory(100);
  const items2000 = fakeInventory(2000);

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-8 text-sm">
      <h1 className="text-xl font-semibold">SearchableSelect — playground</h1>

      <section className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
          10 items, grouped
        </div>
        <SearchableSelect
          items={items10}
          value={small}
          onChange={setSmall}
          placeholder="Pick something"
        />
        <div className="text-xs text-[var(--muted-foreground)]">
          Selected: {small ?? "—"}
        </div>
      </section>

      <section className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
          100 items, grouped + hints
        </div>
        <SearchableSelect
          items={items100}
          value={medium}
          onChange={setMedium}
          placeholder="Link inventory item (optional)"
          searchPlaceholder="Search inventory…"
        />
        <div className="text-xs text-[var(--muted-foreground)]">
          Selected: {medium ?? "—"}
        </div>
      </section>

      <section className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
          2,000 items (perf check)
        </div>
        <SearchableSelect
          items={items2000}
          value={large}
          onChange={setLarge}
          placeholder="Pick from 2000"
        />
        <div className="text-xs text-[var(--muted-foreground)]">
          Selected: {large ?? "—"}
        </div>
      </section>
    </div>
  );
}
