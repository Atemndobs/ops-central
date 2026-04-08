import { Suspense } from "react";
import { MessagesInboxClient } from "@/components/conversations/messages-inbox-client";

export default function CleanerMessagesPage() {
  return (
    <Suspense fallback={<div className="text-sm text-[var(--muted-foreground)]">Loading messages...</div>}>
      <MessagesInboxClient
        basePath="/cleaner/messages"
        title="Messages"
      />
    </Suspense>
  );
}
