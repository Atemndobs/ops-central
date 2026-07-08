"use client";

import { MessageCircle } from "lucide-react";
import { PropertyMessageCard } from "./property-message-card";
import type { PropertyGroup } from "./helpers";

type PropertyMessageListProps = {
  groups: PropertyGroup[];
  selectedPropertyId: string | null;
  onSelectProperty: (group: PropertyGroup) => void;
};

export function PropertyMessageList({
  groups,
  selectedPropertyId,
  onSelectProperty,
}: PropertyMessageListProps) {
  if (groups.length === 0) {
    return (
      <aside className="msg-card flex flex-col items-center justify-center p-8 text-center">
        <MessageCircle
          aria-hidden
          className="mb-3 h-8 w-8"
          style={{ color: "var(--msg-primary)" }}
        />
        <p className="text-sm text-[var(--msg-text-muted)]">
          Conversations appear here after someone opens chat from a job.
        </p>
      </aside>
    );
  }

  return (
    <aside className="flex h-full flex-col">
      <div className="flex flex-col gap-3 overflow-y-auto pr-1">
        {groups.map((group) => (
          <PropertyMessageCard
            key={group.propertyId}
            group={group}
            selected={group.propertyId === selectedPropertyId}
            onClick={() => onSelectProperty(group)}
          />
        ))}
      </div>
    </aside>
  );
}
