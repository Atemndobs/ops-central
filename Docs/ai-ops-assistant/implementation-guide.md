# AI Ops Assistant — Implementation Guide

## File Structure

```
src/
├── app/
│   ├── api/
│   │   └── chat/
│   │       └── route.ts          # AI streaming endpoint
│   └── (dashboard)/
│       └── layout.tsx            # Modified: adds <AiChatPanel />
└── features/
    └── ai-chat/
        └── ai-chat-panel.tsx     # Floating chat UI component
```

## 1. API Route: `/src/app/api/chat/route.ts`

### Auth Pattern

Replicates the existing pattern from `/src/app/api/team-members/route.ts`:

```typescript
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";

const { userId, getToken } = await auth();
if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const token = (await getToken({ template: "convex" }).catch(() => null)) ?? (await getToken());
if (!token) return Response.json({ error: "Auth failed" }, { status: 401 });
convex.setAuth(token);

const profile = await convex.query(api.users.queries.getMyProfile, {});
if (profile.role === "cleaner") return Response.json({ error: "Forbidden" }, { status: 403 });
```

### Model Configuration

```typescript
import { google } from "@ai-sdk/google";

const modelId = process.env.AI_MODEL ?? "gemini-2.5-flash";
const model = google(modelId);
```

### System Prompt

```
You are OpsBot, the AI assistant for OpsCentral property care operations.
Today is {current date}.
You have read-only access to live operations data via tools.
Always call a tool before answering questions about jobs, properties, inventory, or schedules.
Be concise. Use bullet points for lists. Flag urgent items.
You cannot make changes — you are read-only. If asked to modify something, explain that
you can only view data and suggest the user navigate to the relevant page.
```

### Tool Definitions

Each tool wraps an existing Convex query using the `tool()` helper from `ai` with `inputSchema` (Zod) and an `execute` function that calls `convex.query(...)`.

**Important:** Tool `execute` functions should trim large response payloads to reduce token usage. Strip raw IDs, photo arrays, and metadata — return only what the AI needs to answer.

### Streaming Response

```typescript
import { streamText, tool, stepCountIs } from "ai";

const result = streamText({
  model,
  system: systemPrompt,
  messages: modelMessages,
  tools: { ... },
  stopWhen: stepCountIs(5),
});

return result.toUIMessageStreamResponse();
```

## 2. Chat Panel: `/src/features/ai-chat/ai-chat-panel.tsx`

### Component Structure

```
<div fixed bottom-6 right-6 z-40>
  {!isOpen && <FAB button with Bot icon />}
  {isOpen && (
    <div panel w-96 h-[520px]>
      <header>OpsBot + close button</header>
      <div messages overflow-y-auto>
        {messages.length === 0 && <SuggestedQueries />}
        {messages.map(message => <MessageBubble />)}
        {isStreaming && <TypingIndicator />}
      </div>
      <form>
        <input + send button>
      </form>
    </div>
  )}
</div>
```

### useChat Hook

```typescript
import { useChat } from "@ai-sdk/react";

const { messages, sendMessage, status, setMessages } = useChat();
const isStreaming = status === "streaming" || status === "submitted";
```

### Suggested Queries

Shown when no messages exist — quick-tap chips:
- "What's open today?"
- "What needs attention?"
- "Any check-ins coming up?"
- "Show me the review queue"
- "Any low stock items?"

### Styling

- Dark mode compatible (follows existing dashboard theme)
- `bg-zinc-900` panel background, `bg-zinc-800` input area
- `bg-blue-600` for user message bubbles
- `bg-zinc-800` for assistant message bubbles
- `border-zinc-700` borders
- Lucide `Bot` and `Send` icons

## 3. Layout Integration

In `/src/app/(dashboard)/layout.tsx`, add one import and one JSX element:

```typescript
import { AiChatPanel } from "@/features/ai-chat/ai-chat-panel";
```

```tsx
<AiChatPanel />  // Fixed position — doesn't affect flex layout
```

## Convex Queries Used

All queries are called via `ConvexHttpClient` in the API route. None are called from the client component.

| Query Path | Args | Notes |
|-----------|------|-------|
| `api.dashboard.queries.getQuickStats` | `{}` | No args |
| `api.dashboard.queries.getTodayJobs` | `{}` | No args |
| `api.dashboard.queries.getUpcomingCheckins` | `{}` | No args |
| `api.dashboard.queries.getRecentActivity` | `{}` | No args |
| `api.cleaningJobs.queries.getAll` | `{ status?, limit? }` | Status is a string literal union |
| `api.cleaningJobs.queries.getReviewQueue` | `{ status?, limit? }` | Requires reviewer role (admin/property_ops/manager) |
| `api.properties.queries.list` | `{}` | Returns active properties |
| `api.inventory.queries.getLowStock` | `{}` | Returns low_stock + out_of_stock items |
| `api.refills.queries.getQueue` | `{ status?, limit? }` | Requires privileged role |
