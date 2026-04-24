import { Suspense } from "react";
import { MessagesInboxClient } from "@/components/messages/messages-inbox-client";

export default function CleanerMessagesPage() {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-[var(--msg-text-muted,var(--muted-foreground))]">
          Loading messages...
        </p>
      }
    >
      <MessagesInboxClient forceSinglePane />
    </Suspense>
  );
}
