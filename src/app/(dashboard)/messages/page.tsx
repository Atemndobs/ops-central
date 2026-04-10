import { Suspense } from "react";
import { MessagesInboxClient } from "@/components/conversations/messages-inbox-client";

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="text-sm text-[var(--muted-foreground)]">Loading messages...</div>}>
      <MessagesInboxClient title="Messages" />
    </Suspense>
  );
}
