# AI Ops Assistant — Architecture

## System Architecture

```
Browser (any dashboard page)
  └─ AiChatPanel (floating "use client" component)
       └─ useChat() from @ai-sdk/react
            │  HTTP POST + SSE stream
            ▼
  /api/chat/route.ts (Next.js Route Handler)
       ├─ 1. Clerk auth() → extract userId, getToken
       ├─ 2. ConvexHttpClient + Clerk JWT → authenticated Convex client
       ├─ 3. Role check via api.users.queries.getMyProfile → 403 if cleaner
       ├─ 4. streamText() with Gemini model + 9 tools
       │       └─ Each tool calls a Convex query via ConvexHttpClient
       └─ 5. Return SSE stream → useChat() parses and renders
```

## Technology Stack

| Component | Technology |
|-----------|-----------|
| AI Model | Google Gemini (via `@ai-sdk/google`) |
| AI Framework | Vercel AI SDK v6 (`ai@^6.0.0`) |
| React Hooks | `@ai-sdk/react@^3.0.0` (`useChat`) |
| Backend | Convex (existing shared deployment) |
| Auth | Clerk (existing) + ConvexHttpClient pattern |
| UI | Tailwind CSS + Lucide icons (existing) |

## Data Flow

### User asks "What's open today?"

1. User types question in chat panel
2. `useChat()` sends POST to `/api/chat` with message history
3. Route handler authenticates via Clerk
4. `streamText()` sends messages + tool definitions to Gemini
5. Gemini decides to call `getTodayJobs` tool
6. Tool executes `convex.query(api.dashboard.queries.getTodayJobs, {})`
7. Convex returns today's jobs with property/cleaner names
8. Gemini formats the data into a natural-language response
9. Response streams back to the browser via SSE
10. `useChat()` updates messages state, UI renders incrementally

### Auth Flow (replicates /api/team-members pattern)

```typescript
// 1. Clerk session check
const { userId, getToken } = await auth();
if (!userId) → 401

// 2. Convex client with JWT
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
const token = await getToken({ template: "convex" }) ?? await getToken();
convex.setAuth(token);

// 3. Role gate
const profile = await convex.query(api.users.queries.getMyProfile, {});
if (profile.role === "cleaner") → 403
```

## Tools Inventory

All tools are **read-only** — they call existing Convex queries, no mutations.

| Tool | Convex Query | Args | Returns |
|------|-------------|------|---------|
| `getQuickStats` | `dashboard.queries.getQuickStats` | none | Counts: todayJobs, inProgress, completedToday, needsAttention, upcomingCheckins, openJobs |
| `getTodayJobs` | `dashboard.queries.getTodayJobs` | none | Today's jobs with status, property name, cleaner name, urgency flag |
| `getUpcomingCheckins` | `dashboard.queries.getUpcomingCheckins` | none | Next 3 days of check-ins with guest/property info |
| `getRecentActivity` | `dashboard.queries.getRecentActivity` | none | Last 24h job status changes with property/cleaner context |
| `getJobsByStatus` | `cleaningJobs.queries.getAll` | `status?`, `limit?` | Jobs filtered by status, enriched with property/cleaner data |
| `getReviewQueue` | `cleaningJobs.queries.getReviewQueue` | `status?`, `limit?` | Jobs needing review, priority-sorted (awaiting_approval first) |
| `getProperties` | `properties.queries.list` | none | Active properties with details |
| `getLowStockItems` | `inventory.queries.getLowStock` | none | Items with low_stock or out_of_stock status, with property/category names |
| `getRefillQueue` | `refills.queries.getQueue` | `status?`, `limit?` | Refill queue items with priority levels |

## Files Created/Modified

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/app/api/chat/route.ts` | AI streaming endpoint with Gemini + tools |
| Create | `src/features/ai-chat/ai-chat-panel.tsx` | Floating chat UI component |
| Modify | `src/app/(dashboard)/layout.tsx` | Wire in chat panel (1 import + 1 JSX line) |

## Key Design Decisions

1. **Read-only** — no mutations, safe for the shared Convex backend
2. **Floating panel** — accessible from anywhere, doesn't interrupt workflow
3. **Reuses existing queries** — no new Convex functions needed
4. **Same auth pattern** as existing API routes — Clerk + ConvexHttpClient
5. **No chat history persistence** (v1) — in-memory via `useChat`
6. **No new Convex tables** — respects shared backend constraint
7. **Gemini model** — using Google's Gemini via `@ai-sdk/google`

## Dependencies Added

```json
{
  "ai": "^6.0.0",
  "@ai-sdk/react": "^3.0.0",
  "@ai-sdk/google": "latest"
}
```

## Environment Variables Required

```bash
# Google Gemini API key (required)
GOOGLE_GENERATIVE_AI_API_KEY=your-google-api-key

# Optional: override default model
AI_MODEL=gemini-2.5-flash
```
