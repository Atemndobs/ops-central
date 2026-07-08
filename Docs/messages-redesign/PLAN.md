# Messages Area Redesign — Implementation Plan

**Status:** Draft v1 (awaiting approval)
**Owner:** OpsCentral web (`/messages`)
**Date:** 2026-04-22
**Source inputs:**
- `prd-v1-chat.md` (empty PRD template — captured as "requirements TBD")
- Hand sketches: `property-message-list-v1-p2.jpeg`, `property-chat-v1-p1.jpeg`, `property-chat-v2-p1.jpeg`, `property-chat-v1-p1-fullscreeen.jpeg`, `property-message-list-v2-p2.jpeg`
- Stitch concepts: `messages_property_list_option_1/`, `messages_tabbed_chat_option_2/`
- Design system: `luminous_purple_system/DESIGN.md`
- Current code: `src/components/conversations/messages-inbox-client.tsx`, `conversation-thread.tsx`, `job-conversation-lanes-panel.tsx`

---

## 1. What we understood from the inputs

### From the sketches
1. **List screen (p2):**
   - Title **"All Property Messages"**, sorted by **address / name**.
   - Each row = home icon + property name + unit/variant name + **NEW** badge + chevron.
   - Search bar is a **scaling-phase** addition (nice-to-have, not v1).
2. **Chat screen (p1-v1 & fullscreen):**
   - Header: avatar/user + property title ("Vilbig Road – The Scandi") + language indicator (EN) + settings.
   - **Translation banner**: "Translation on · Show original" — sticky at top of the thread. Translates all messages at once.
   - Chat bubbles: incoming (left) + outgoing (right), plus a **system/internal update card** in-line (green "INTERNAL UPDATE" label).
   - Composer: pill input + send button.
   - Bottom nav: 4 items (Messages, Properties, Tasks, Profile) — mobile only.
3. **Chat screen with tabs (p1-v2):**
   - Tabs at the top of the chat (max **4 properties/city**, e.g., "Dallas-Scandi", "Oak Ridge", "The Loft", "Downtown").
   - If user has **> 4 properties per city**: add an **"all properties"** link that opens a modal with a scrollable property list ("Your properties"). This is the pattern for big cleaning companies / multi-unit portfolios.

### From the Stitch concepts
- **Option 1 ("property list"):** a clean, card-based property list — hero photo, name, address, last preview, NEW badge, timestamp. One row per property (not per job/conversation).
- **Option 2 ("tabbed chat"):** thumbnail tabs, translation banner, soft-purple incoming bubbles, white outgoing bubbles, green-accented "INTERNAL UPDATE" cards, pill composer.

### From the design system (Luminous Purple)
- Typeface **Manrope**; base 14px body, bold 20px H1.
- Primary `#7341b3` / `#9C6ADE` purple, soft secondary `#F3E8FF` for incoming bubbles.
- Corner radii: cards `rounded-xl`, bubbles `rounded-lg`, buttons pill.
- Tonal elevation: #FFF card on #F9FAFB background; ambient shadow `0 2px 8px rgba(0,0,0,0.05)`.
- **INTERNAL** badges in green uppercase with letter-spacing.

### From the current codebase
- `/messages` already groups conversations by property (`groupByProperty`) and supports two lanes: `internal_shared` and `whatsapp_cleaner`.
- `ConversationThread` renders one thread at a time with message list + composer.
- Convex is the single source of truth (`api.conversations.queries.listMyConversations`). Zero business logic in Next.js — this stays.

---

## 2. Goals

| # | Goal | How we'll measure |
|---|------|-------------------|
| G1 | Make "What needs my attention?" obvious at a glance | Unread + NEW property surfaces to the top; first row reached in ≤1 scroll |
| G2 | Reduce context-switch cost when bouncing between 2–4 properties | Tab strip with property thumbnails; current property persists on refresh |
| G3 | Support multi-lingual teams (EN ↔ ES cleaners) | Global translation toggle inside the thread; one-click "Show original" |
| G4 | Scale to cleaning companies with many properties/city | "All properties" modal picker when tabs overflow |
| G5 | Keep parity with cleaner mobile app | Same Convex queries/mutations; visual language aligned with Luminous Purple |

### Non-goals (v1)
- Multi-select / bulk archive
- Advanced filters (channel, date range)
- Full-text search across messages (scaling-phase)
- Voice / attachment redesign (keep current behavior)

---

## 3. Information architecture

The redesign treats **property** as the primary grouping, **thread (job / whatsapp-cleaner)** as secondary. This matches the current Convex data and the sketches.

```
/messages
 ├── List View       (default when no ?conversationId)
 │    └── Property cards → click opens a thread
 └── Thread View     (?conversationId=<id>)
      ├── Property tab strip (max 4)
      │    └── "All properties" modal (>4)
      ├── Translation banner (sticky)
      ├── Message stream (user / system / internal)
      └── Composer
```

Desktop uses a **split-pane** layout inside the dashboard shell. Mobile collapses to a **single-pane** with back-button navigation.

---

## 4. Wireframes

### 4.1 Desktop — Split pane (list + thread)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  [OpsCentral sidebar]  │  All Property Messages                     [EN ▾] [⚙]  │
│                        ├──────────────────────────────┬───────────────────────────┤
│  ▸ Dashboard           │  🔎 Search properties…       │  ◀ Vilbig Rd – The Scandi│
│  ▸ Schedule            │  ─────────────────────────── │  ─────────────────────────│
│  ▸ Jobs                │                              │  [🏠][🏠][🏠][🏠] +2     │
│  ▸ Properties          │ ┌──────────────────────────┐ │   Scandi  Oak  Loft  Dwn │
│  ● Messages   (3)      │ │[img] San Jacinto 1   NEW │ │  ────────────────────────│
│  ▸ Team                │ │     1202 San Jacinto Blvd│ │  🌐 Translation ON ·      │
│  ▸ Inventory           │ │     💬 "Kitchen tap…"  2m│ │      Show original        │
│  ▸ Reports             │ └──────────────────────────┘ │  ────────────────────────│
│  ▸ Settings            │ ┌──────────────────────────┐ │                          │
│                        │ │[img] Vilbig Road         │ │  ┌────────────────────┐ │
│                        │ │     4501 Vilbig St  INT  │ │  │ Hello! I've conf…  │ │
│                        │ │     💬 "Can we sched…"1h │ │  └────────────────────┘ │
│                        │ └──────────────────────────┘ │    Atem · 09:42          │
│                        │ ┌──────────────────────────┐ │           ┌────────────┐ │
│                        │ │[img] Waller St           │ │           │Perfect, thx│ │
│                        │ │     1100 Waller       Yst│ │           └────────────┘ │
│                        │ └──────────────────────────┘ │                  09:45 ✓✓│
│                        │                              │  ┌──────────────────────┐│
│                        │  [View older ▾]              │  │ INTERNAL UPDATE      ││
│                        │                              │  │ Req #442 → high prio ││
│                        │                              │  └──────────────────────┘│
│                        │                              │  ─────────────────────── │
│                        │                              │  [➕] [Type a message…] ▶ │
│                        └──────────────────────────────┴───────────────────────────┘
└──────────────────────────────────────────────────────────────────────────────────┘
   breakpoint ≥ lg (1024px): list 360px, thread flex-1
```

### 4.2 Mobile — List view (single pane)

```
┌──────────────────────────────┐
│ ◀  Property Messages   [⚙]  │  ← header (sticky)
├──────────────────────────────┤
│ 🔎  Search properties…       │  ← (scaling phase)
├──────────────────────────────┤
│ All Property Messages        │
│                 SORTED BY ADDR│
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │[🏠]  San Jacinto 1   NEW │ │
│ │      The Andaluz      2m │ │
│ │ 💬  "Kitchen tap lea…" ▸ │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │[🏠]  Vilbig Road    INT  │ │
│ │      The Scandi       1h │ │
│ │ 💬  "Can we sched…"   ▸  │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │[🏠]  Waller St – Hts Mod │ │
│ │      1100 Waller   Yst   │ │
│ │ 💬  "Inspection rep…" ▸  │ │
│ └──────────────────────────┘ │
│                              │
│                     [   ➕ ] │ ← FAB "new message"
├──────────────────────────────┤
│ 💬     🏢      ☑       👤   │ ← bottom nav (mobile only)
│ Msgs   Props  Tasks  Profile │
└──────────────────────────────┘
```

### 4.3 Mobile — Chat view (single pane, ≤4 properties/city)

```
┌──────────────────────────────┐
│ ◀  Vilbig Rd – The Scandi ⚙ │
├──────────────────────────────┤
│ [🏠][🏠][🏠][🏠]             │ ← property tabs (max 4)
│  Scan Oak  Loft Dwn          │
│  ▔▔▔▔                        │   active underline (purple)
├──────────────────────────────┤
│ 🌐 Translation ON ·          │ ← sticky banner
│    Show original             │
├──────────────────────────────┤
│                              │
│  ┌────────────────────┐      │
│  │ Hello! I've conf…  │      │ ← incoming (soft purple)
│  └────────────────────┘      │
│  Atem · 09:42                │
│                              │
│        ┌──────────────────┐  │
│        │Perfect, thx. Will│  │ ← outgoing (white + border)
│        │they also…        │  │
│        └──────────────────┘  │
│                    09:45 ✓✓  │
│                              │
│  ┌──────────────────────────┐│
│  │ INTERNAL UPDATE          ││ ← system card (green label)
│  │ Req #442 → high priority ││
│  └──────────────────────────┘│
│                              │
│  ┌────────────────────┐      │
│  │ Yes, laundry is…   │      │
│  └────────────────────┘      │
├──────────────────────────────┤
│ [➕] [Type a message… ] [▶]  │ ← pill composer
├──────────────────────────────┤
│ 💬   🏢    ☑    👤           │
└──────────────────────────────┘
```

### 4.4 Mobile — Chat with overflow (> 4 properties/city)

```
┌──────────────────────────────┐
│ ◀  Dallas – Scandi        ⚙ │
├──────────────────────────────┤
│ ┌─────────────┐              │
│ │Dallas–Scandi│ View all ▸   │ ← single active tab + link
│ └─────────────┘              │
├──────────────────────────────┤
│ 🌐 Translation ON · Show…    │
│ … thread …                   │
└──────────────────────────────┘

     tapping "View all" ▸

┌──────────────────────────────┐
│  Your properties        [✕] │ ← modal sheet
├──────────────────────────────┤
│ ● San Jacinto 1 — Andaluz   │
│ ● San Jacinto 2 — Canary    │
│ ● Vilbig Road — Scandi      │ ← checkmark = current
│ ● Waller St — Hts Modern    │
│ ● Zilker Park Side          │
│ ● Oak Ridge                 │
│ ● The Loft                  │
│ ● Downtown                  │
│ …                            │
├──────────────────────────────┤
│ [Cancel]    [Open thread ▶] │
└──────────────────────────────┘
```

### 4.5 Message bubble anatomy

```
incoming                         outgoing
┌───────────────────────┐                   ┌───────────────────────┐
│ Hello! I've confirmed │                   │ Perfect, thank you!   │
│ the cleaning for…     │                   │                       │
└───────────────────────┘                   └───────────────────────┘
  Atem · 09:42                                           09:45 ✓✓
  bg: #F3E8FF  radius 12px (tail-corner 4px)   bg: #FFFFFF + border
  text: #1F2937                                 text: #1F2937
  max-width: 75ch / 420px

system / internal
┌────────────────────────────────────────────┐
│ INTERNAL UPDATE                            │
│ Maintenance req #442 marked high priority. │
└────────────────────────────────────────────┘
  bg: #F9FAFB  radius 12px
  label: #166534 uppercase, letter-spacing .05em
  full-width, centered
```

---

## 5. Design tokens mapping

Adopt the Luminous Purple palette as a **layer on top of** the existing OpsCentral tokens. Tokens go in `src/app/globals.css` under a `.theme-messages` scope so we don't disturb other pages in v1.

| Token | Value | Usage |
|-------|-------|-------|
| `--msg-surface` | `#F9FAFB` | Page background |
| `--msg-card` | `#FFFFFF` | Property cards, outgoing bubble |
| `--msg-bubble-in` | `#F3E8FF` | Incoming bubble |
| `--msg-primary` | `#7341B3` | Active tab, send button, NEW badge |
| `--msg-primary-container` | `#EEDCFF` | Translation banner bg |
| `--msg-internal` | `#166534` | INTERNAL label text |
| `--msg-internal-bg` | `#DCFCE7` | INTERNAL card bg |
| `--msg-text` | `#1F2937` | Body text |
| `--msg-text-dim` | `#4B5563` | Metadata / timestamps |
| radius `lg` | `1rem` | Cards |
| radius `md` | `0.75rem` | Bubbles |
| radius `full` | pill | Composer, primary buttons |
| shadow `card` | `0 2px 8px rgba(0,0,0,.05)` | Property cards |

Font: keep Geist Sans in the shell; switch **`/messages` route** to **Manrope** via `next/font/google` to match the sketches.

---

## 6. Component plan

### New components (in `src/components/messages/`)
| Component | Responsibility |
|-----------|---------------|
| `MessagesLayout` | Split-pane shell; handles list vs thread responsive routing |
| `PropertyMessageList` | Replacement for current property-grouped list; card-per-property |
| `PropertyMessageCard` | One property row (image, name, address, NEW/INTERNAL badge, last preview, time) |
| `PropertyTabStrip` | 4-thumbnail tab bar inside the thread header; overflow → "View all" link |
| `PropertyPickerModal` | Sheet/modal listing all properties when tabs overflow |
| `TranslationBanner` | Sticky banner: "Translation ON · Show original" toggle |
| `MessageBubble` | Renders incoming / outgoing variants with timestamp + read receipts |
| `SystemMessageCard` | Renders system / internal-update cards |
| `ChatComposer` | Pill input + attachment + send, keyboard-aware |

### Refactors
- `messages-inbox-client.tsx` → split into `PropertyMessageList` + thread routing logic. Keep `groupByProperty`, `isCurrentOrUpcoming` as pure helpers in `src/components/messages/helpers.ts`.
- `conversation-thread.tsx` → keep as orchestrator; swap internal renderers for `MessageBubble` / `SystemMessageCard` / `ChatComposer`.
- `job-conversation-lanes-panel.tsx` → lanes become a segmented control at the top of the thread (internal ↔ whatsapp), keeping today's semantics.

### No backend changes required for v1
- `api.conversations.queries.listMyConversations` already returns everything we need.
- Translation (§ 7) is the only feature that requires backend work — scoped to v1.1.

---

## 7. Translation feature

Per the sketches, translation is the most distinctive new piece.

**v1 (client-only, cheap):**
- Toggle is per-user, persisted in `localStorage` and Clerk `unsafeMetadata`.
- When ON, the thread calls a Convex action `translateMessages({ conversationId, targetLang })` that returns translated strings for a visible window; cached in a new `messageTranslations` table keyed by `(messageId, targetLang)`.
- "Show original" just re-renders the source text — no round-trip.
- Sent messages are **not** translated on send (v1). Incoming cleaner messages in ES are translated to EN for ops; we add ES translation of outgoing messages later.

**Acceptance:**
- Toggle state survives page reload.
- Translated text appears within 2s for a 20-message thread.
- Original is reachable in 1 click; no message content is lost.

**Open question:** which LLM provider (Vercel AI Gateway vs direct)? Decide before 1.1 scoping.

---

## 8. Responsive behavior

| Breakpoint | Layout |
|------------|--------|
| `< 768px` (mobile) | Single pane. `/messages` = list. `/messages?conversationId=…` = thread. Back button returns to list. Bottom nav visible. |
| `768–1023px` (tablet) | Single pane + persistent OpsCentral sidebar. Same routing as mobile. |
| `≥ 1024px` (desktop) | Split pane: list `360px`, thread `flex-1`. Clicking a card updates `?conversationId` without full navigation. |

Routing uses the **existing** `?conversationId=` search param so deep links already work.

---

## 9. Data / edge cases

| Case | Behavior |
|------|----------|
| Property with zero conversations | Hidden from list (already current behavior) |
| Unread threads | Property card shows **NEW** badge + moves to top |
| WhatsApp service-window closed | Composer disabled with tooltip (unchanged from today) |
| > 4 properties per city in tab strip | Collapse to 1 active tab + "View all" → modal picker |
| No property (rare/legacy data) | Renders under "Unknown Property" group at bottom (current behavior) |
| Translation API down | Banner shows `Translation unavailable`; falls back to originals; no error toast |

---

## 10. Implementation phases

Broken into small, independently shippable PRs on `feature/messages-redesign`.

### Phase 1 — Visual refresh, no new features (1–2 days)
- Add Manrope font + `--msg-*` tokens scoped to `/messages`.
- Rebuild `PropertyMessageList` with card layout (image, address, preview, NEW/INT badge).
- Swap bubble colors in `ConversationThread` to purple/white + add `SystemMessageCard`.
- No backend changes.
- **Ships as:** same behavior, new skin.

### Phase 2 — Split-pane layout (desktop) (1 day)
- New `MessagesLayout` with list + thread columns at `≥lg`.
- Mobile/tablet unchanged.
- Deep-link URL stays `?conversationId=…`.

### Phase 3 — Property tab strip + "View all" modal (1–2 days)
- `PropertyTabStrip` in thread header with thumbnails (reuse property hero image if available, else home icon).
- Overflow → `PropertyPickerModal` (shadcn `Dialog` on desktop, `Sheet` on mobile).
- Tab order: the 4 most-recent properties for the signed-in user, pinned active last-visited first.

### Phase 4 — Translation v1 (2–3 days)
- Convex: new `messageTranslations` table + `translateMessages` action.
- `TranslationBanner` component + per-user preference (Clerk metadata).
- Cache translations; "Show original" is a render-only toggle.
- Requires provider decision (see § 7).

### Phase 5 — Scaling polish (post-launch)
- Search bar on the list (client-side first, server-side when > 200 properties).
- Attachment/photo upload refresh.
- Per-lane segmented control (internal ↔ whatsapp) polish.

Each phase ends with: test in both Convex lanes (`internal_shared`, `whatsapp_cleaner`), verify cleaner mobile app still works (shared backend), screenshot before/after for PR.

---

## 11. File / folder touchpoints

```
opscentral-admin/
├── src/app/(dashboard)/messages/page.tsx                 # unchanged wrapper
├── src/app/globals.css                                   # + --msg-* tokens
├── src/components/messages/                              # NEW folder
│   ├── index.ts
│   ├── messages-layout.tsx
│   ├── property-message-list.tsx
│   ├── property-message-card.tsx
│   ├── property-tab-strip.tsx
│   ├── property-picker-modal.tsx
│   ├── translation-banner.tsx
│   ├── message-bubble.tsx
│   ├── system-message-card.tsx
│   ├── chat-composer.tsx
│   └── helpers.ts                                        # groupByProperty, isCurrentOrUpcoming
├── src/components/conversations/                         # keep, refactor imports
│   ├── conversation-thread.tsx                           # slim to orchestrator
│   └── messages-inbox-client.tsx                         # delete after Phase 2
└── convex/
    ├── schema.ts                                         # + messageTranslations (Phase 4)
    └── conversations/
        ├── queries.ts                                    # unchanged v1.0
        └── translations.ts                               # NEW (Phase 4)
```

---

## 12. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Shared Convex = breaks cleaner mobile app | Every backend change dual-tested against `jna-cleaners-app`; schema-only additions in Phase 4 (no column renames) |
| Font swap shifts layout / CLS | Scope Manrope to `/messages` only; keep Geist everywhere else |
| Tab strip with property images lacks hero photos | Fall back to first-letter tile + theme color; add a migration to seed `property.heroImageUrl` from existing photo uploads |
| Translation cost unbounded | Cache per `(messageId, targetLang)`; only translate visible window on demand; add per-user quota env var |
| Users confused by new layout | Ship Phase 1 behind feature flag `messages.v2` for ~3 days with internal users first |

---

## 13. Open questions (need answers before Phase 3 & 4)

1. **Property thumbnails** — Is there a canonical "hero photo" field on `properties` today, or do we need a migration?
2. **Tab order & pinning** — Most-recent activity, or user-pinned favorites?
3. **Translation provider** — Vercel AI Gateway (OpenAI / Claude Haiku) vs Google Translate API? Cost and latency dictate this.
4. **Outgoing translation** — Should ops messages be auto-translated to ES when the recipient is a Spanish-speaking cleaner? (Likely yes for v1.1.)
5. **Bottom nav on web** — The sketches show a 4-icon mobile bottom nav. OpsCentral is admin-web; we should drop it on desktop and rely on the dashboard sidebar. Confirm.

---

## 14. Definition of Done for v1 (Phases 1–3)

- [ ] `/messages` desktop shows split-pane with new visual language
- [ ] `/messages` mobile shows card list + single-pane thread
- [ ] Property tabs render (≤4) with overflow modal (>4)
- [ ] All existing features still work: lanes, unread, WhatsApp service window, deep links
- [ ] Cleaner mobile app verified unchanged against same Convex deployment
- [ ] Screenshots (before/after) attached to each PR
- [ ] No new TypeScript `any`; components use Server Components where possible (composer + bubbles stay `"use client"`)

---

**Next step:** get approval on §4 wireframes and §13 open questions, then branch off `feature/messages-redesign` and ship Phase 1.
