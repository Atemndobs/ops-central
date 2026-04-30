# Granola-Inspired Chat Input — Design & Implementation Doc

**Status:** Draft v2 (revised against current code structure)
**Created:** 2026-04-28
**Revised:** 2026-04-30
**Owner:** Messaging redesign track
**Branch:** `feature/messages-granola-composer`
**Reference image:** Screenshot of Granola's chat input tile (composer with quick-action chips above the input row, mic button anchored bottom-right, paperclip attach, model selector, and "expand" affordance).

---

## 0. Revision notes (v1 → v2)

The v1 draft proposed a brand-new `src/components/messages/ChatComposer/` folder and a new `composer.granola_v1` feature flag. **Both were oversights** — they ignore code that already exists. Corrections in v2:

- **Composer location.** The composer is *already* implemented inline in
  [src/components/conversations/conversation-thread.tsx](../../src/components/conversations/conversation-thread.tsx)
  (the `<form>` block starting around line 620). All refactor work happens
  there, or by extracting a sibling file under
  `src/components/conversations/` (e.g. `chat-composer.tsx`). **Do not**
  create a `src/components/messages/ChatComposer/` folder — that would
  fork the messaging UI in two.
- **Speech-to-text feature flag already exists.** `voice_messages` in
  [convex/admin/featureFlags.ts](../../convex/admin/featureFlags.ts)
  gates the mic button. It is admin-toggleable from
  Settings → Feature flags
  ([src/components/settings/feature-flags-card.tsx](../../src/components/settings/feature-flags-card.tsx))
  and read from the composer via
  `useQuery(api.admin.featureFlags.isFeatureEnabled, { key: "voice_messages" })`
  ([conversation-thread.tsx:179](../../src/components/conversations/conversation-thread.tsx)).
  The mic UI **already** disappears when an admin flips the flag off.
  The companion `voice_audio_attachments` flag controls whether the raw
  audio is retained as a playable attachment vs. discarded after
  transcription. **No new flag is required for STT.**
- **Voice → text default.** The existing admin behaviour (transcript
  appended to the textarea body via `VoiceRecordButton.onTranscript`) is
  the desired Granola-style behaviour. We keep it.
- **Video attach is also already wired** via the inline paperclip in the
  same composer, gated by the build-time `NEXT_PUBLIC_ENABLE_VIDEO` env
  AND the runtime `video_support` flag (see
  [src/hooks/use-is-video-enabled.ts](../../src/hooks/use-is-video-enabled.ts)
  for the AND-gate pattern we will mirror for any future cost-incurring
  feature).

So the v2 plan is **not** "build a new composer." It is "evolve the
existing composer in `conversation-thread.tsx` to match the Granola
shape, behind a Granola-only feature flag we add to the existing
`featureFlags` table."

---

## 1. Goal

Evolve the current chat composer on the property/job messaging surface
to mirror the Granola affordances:

- A pill-shaped input ("Type a message…") as the visual anchor.
- A row of **quick-action chips** sitting *above* the input (e.g.
  "Confirm next clean", "Send arrival window", "Ask for photo of
  issue"), used for prompt shortcuts.
- A single **trailing action cluster** inside the input on the right
  side, in this order, right-to-left:
  1. **Mic / Send** (single slot — mic when input empty, send paper
     plane when there's text or attachments).
  2. **Attach** (paperclip → unified picker for image / file / camera /
     video).
  3. **Model / mode selector** ("Auto ▾") — hidden until AI assist
     phase ships.
- A small **expand-to-fullscreen** icon button at the top-right corner
  of the tile.

The microphone position is non-negotiable: it must occupy the
right-most slot inside the input — same thumb-zone position Granola,
ChatGPT, and WhatsApp use.

---

## 2. Why this shape

| Need                                                | How the tile satisfies it                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Cleaners send most messages from a phone, one-thumb | Mic anchored bottom-right, large hit target                                                      |
| Photo-of-issue and document attach are core flows   | One paperclip → unified picker (image / file / camera / video), no separate buttons cluttering the input |
| Ops/admin sometimes want a "prompt" not a "message" | Quick-action chips above the input promote suggested prompts without taking input real estate   |
| Want a path to AI-assisted replies later            | "Auto ▾" model selector is a first-class slot — wired to AI SDK provider routing when we turn AI on |
| Feels like one product, not a chat box bolted on    | Single rounded tile, mirrors Granola's calm composer                                             |

---

## 3. Anatomy

```
┌──────────────────────────────────────────────────────────────┐
│  [⎘ Confirm clean] [⎘ Arrival window] [📷 Ask photo]      ⤢ │  ← chip row + expand
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Type a message…                       Auto ▾  📎  ◯🎙 │  │  ← input row
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Slots

| Slot                                               | Purpose                                                           | Required? |
| -------------------------------------------------- | ----------------------------------------------------------------- | --------- |
| `chips`                                            | 1–4 prompt shortcuts; horizontally scrollable on mobile           | Optional  |
| `expandButton`                                     | Opens the composer in a full-screen sheet                         | Optional  |
| `input`                                            | Multiline textarea; auto-grows up to ~6 lines                     | Required  |
| `modelSelector`                                    | Dropdown for model/mode. Hidden when AI is off                    | Optional  |
| `attachButton`                                     | Single entry point to image/file/camera/video picker              | Required  |
| `micButton`                                        | Voice capture; tap to start, tap to stop, transcript inserts text | Required  |
| `sendButton` (replaces mic when text is non-empty) | Sends the message; mic returns when input is cleared              | Required  |

The mic↔send swap is the headline behaviour change vs. today's
composer (which always shows both buttons side-by-side).

---

## 4. Where the changes land in the existing code

We modify and lightly extract from
[src/components/conversations/conversation-thread.tsx](../../src/components/conversations/conversation-thread.tsx):

| Block                                                | Change                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `<form>` composer (~line 620 → 800)                  | Refactor JSX into a new sibling component `src/components/conversations/chat-composer.tsx`. Keep all current props/handlers — pure extraction first, behaviour change second. |
| `voiceMessagesEnabled` query                         | Stays. This is the STT admin toggle.                                                          |
| `videoEnabled` (`useIsVideoEnabled()`)               | Stays. Video attach moves under the unified paperclip popover but the gate is unchanged.      |
| `<textarea>`                                         | Wrap inside the new pill tile. Keyboard contract flips: `Enter` = newline, `Cmd/Ctrl+Enter` = send. (See §5.6.) |
| `<VoiceRecordButton>` + `<button type="submit">`     | Collapse to a **single** right-most slot that swaps between mic and send based on `body.trim().length` and pending attachments. |
| Video paperclip                                      | Move into a unified `AttachPopover` (Take photo / Choose photo / Choose file / Record video). Uses existing handlers and existing Convex `generateUploadUrl`. |
| (new) Chip row above textarea                        | Render `chips?: ComposerChip[]` prop; tapping fills the textarea or runs `onSelect`.          |
| (new) Expand button (top-right)                      | Opens a Radix `Sheet` containing the same composer + thread tail.                             |

We are **not** creating a `src/components/messages/ChatComposer/`
folder. The new file lives next to its callers in
`src/components/conversations/`, alongside `conversation-thread.tsx`
and `job-conversation-panel.tsx`.

---

## 5. Behavior spec

### 5.1 Mic / send swap

```
text.trim().length === 0 && pendingVideo == null && pendingAudio == null
    →  show Mic
otherwise
    →  show Send (paper plane)
```

Tapping mic with empty input starts recording (existing
`VoiceRecordButton` handles the permission + capture + transcription
flow). When `voice_messages` is OFF, the mic slot is hidden entirely;
the slot collapses and Send shows only when there's content.

### 5.2 Attach button (unified popover)

A single tap opens a popover (desktop) or bottom sheet (mobile) with
options:

1. **Take photo** — `<input type="file" capture="environment" accept="image/*">`
2. **Choose photo** — `<input type="file" accept="image/*" multiple>`
3. **Choose file** — `<input type="file" multiple>`
4. **Record video** — gated by `useIsVideoEnabled()` (env AND runtime flag); reuses today's video upload pipeline at [conversation-thread.tsx:716](../../src/components/conversations/conversation-thread.tsx).

This routes through the existing photo upload pipeline documented in
[2026-04-04-photo-upload-architecture-admin-web.md](../2026-04-04-photo-upload-architecture-admin-web.md).
Do **not** create a parallel pipeline.

### 5.3 Model selector ("Auto ▾")

- **Hidden until the AI assist phase ships.** Behind a future
  `messages_ai_assist` flag (to be added when that work starts).
- When visible, opens a small popover: `Auto`, `Claude Sonnet 4.6`,
  `Claude Haiku 4.5`, `GPT-5`, etc.
- "Auto" routes through Vercel AI Gateway. Selecting a specific model
  pins that turn only.
- See AI SDK docs (https://sdk.vercel.ai/docs) and AI Gateway
  (https://vercel.com/docs/ai-gateway) before wiring.

### 5.4 Quick-action chips

- Tapping a chip calls `chip.onSelect?.()` if provided, otherwise sets
  the textarea body to `chip.prompt` and focuses it.
- Chip set is config-driven per surface (property thread, job thread,
  cleaner PWA). Initial chip set for property threads:
  - "Confirm next clean"
  - "Send arrival window"
  - "Ask for photo of issue"
  - "Mark complete & thank"
- Strings are localized (en/es) via the existing i18n setup.
- On mobile, the chip row scrolls horizontally and snaps to the
  leading edge.

### 5.5 Expand-to-fullscreen

- Top-right diagonal-arrows icon. Visible only when `expandable && onExpand`.
- Opens a full-screen Radix `Sheet` with the same composer rendered
  larger and the message thread tail visible above. Useful on mobile
  when typing long handovers.

### 5.6 Keyboard

| Key                | Action                                                              |
| ------------------ | ------------------------------------------------------------------- |
| `Enter`            | Insert newline (composer is multiline)                              |
| `Cmd/Ctrl + Enter` | Send                                                                |
| `Esc`              | Cancel recording or collapse expanded sheet                         |
| `Cmd/Ctrl + K`     | Focus the composer (global shortcut on messages pages)              |

This is a **behavior flip** from today (today `Enter` sends). The
flip is intentional — multiline drafts are common for ops handovers
and one of the most-cited frustrations with the current composer.

### 5.7 Accessibility

- Mic and send buttons are `role="button"` with explicit aria-labels
  (`Record voice message`, `Send message`).
- Recording state announced via `aria-live="polite"` ("Recording, 0:08").
- Quick-action chips are a `role="toolbar"` with
  `aria-label="Suggested prompts"`.
- Min 44×44 pt hit targets on mobile (matches the cleaner PWA
  accessibility line in the design system).

---

## 6. Visual / token mapping

Use the unified design-system tokens at
[design-system/tokens/](../../design-system/tokens/) — never hard-code
colors. The composer already references `--msg-*` CSS vars; we extend
the same set rather than introducing new ones.

| Surface                          | Admin (dark)                              | Cleaner PWA (light)                       |
| -------------------------------- | ----------------------------------------- | ----------------------------------------- |
| Tile background                  | `surface.elevated` (~`oklch(0.22 0 0)`)   | `surface.card` (white)                    |
| Tile border                      | `border.subtle`                           | `border.subtle`                           |
| Input border (focus)             | 1px `accent.primary` outer ring           | 1px purple primary ring                   |
| Mic button                       | Filled circle, `surface.muted`            | Filled circle, `surface.muted`            |
| Send button (active)             | Filled circle, `accent.primary`           | Filled circle, purple primary             |
| Recording pulse                  | `state.danger` 60% opacity halo           | same                                      |
| Chip                             | Pill, `surface.muted` bg, 1px border      | same                                      |
| Chip icon                        | 16px, `text.muted`                        | same                                      |

Border radius: tile `2xl`, input `xl`, chips `full`. Shadow: none —
rely on border + surface contrast (Granola does the same).

Density:

- Tile padding: `p-3` mobile / `p-4` desktop.
- Input row vertical padding: `py-2.5`.
- Chip row gap: `gap-2`.

---

## 7. Where it plugs in

The same extracted `<ChatComposer />` ships to all surfaces that
currently embed the composer block of `conversation-thread.tsx`:

| Surface                                     | Today's call site                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| Property messaging (admin, dark)            | `/messages` route → `messages-inbox-client.tsx` → `ConversationThread`     |
| Job thread                                  | `job-conversation-panel.tsx` → `ConversationThread`                        |
| Cleaner PWA chat (`/cleaner` routes)        | (future light-mode reuse — same component, different theme tokens)         |
| Future: ops AI assistant                    | First and only composer; chips + model selector both visible              |

Differences are configuration, not new components:

| Surface             | `chips`             | `modelSelector` | `expandable` | Theme  |
| ------------------- | ------------------- | --------------- | ------------ | ------ |
| Property messaging  | property prompts    | hidden          | yes          | dark   |
| Job thread          | job prompts         | hidden          | yes          | dark   |
| Cleaner chat        | cleaner prompts     | hidden          | no           | light  |
| Ops AI assistant    | assistant prompts   | visible         | yes          | dark   |

---

## 8. State management

The new `chat-composer.tsx` is **stateless about transport**. It owns
only:

- Local `body` text (lifted up to `ConversationThread` today —
  preserve that contract).
- `pendingVideo` / `pendingAudio` lifecycle (already lifted).
- Recording state machine: `idle → requesting-permission → recording → finalizing → idle` (already inside `VoiceRecordButton`).

It does **not** call Convex directly. All persistence flows through
the same hooks already in use:

- `sendMessage` mutation (existing).
- `sendWhatsAppReply` mutation (existing).
- `generateUploadUrl` action for video (existing).
- `VoiceRecordButton` for audio capture + transcription (existing).

Per OpsCentral rule: **all business logic lives in Convex**. The
composer is UI only.

---

## 9. Voice → text (STT) — already shipped, just relocated

This section is about acknowledging what already exists, not building
something new.

- **Admin runtime toggle:** `voice_messages` flag in
  [convex/admin/featureFlags.ts](../../convex/admin/featureFlags.ts).
  Toggleable from Settings → Feature flags. **This is the on/off
  switch the ops team requested for cost control.** No new flag
  needed.
- **Audio retention toggle:** `voice_audio_attachments` flag, same
  table. When ON, the raw audio is kept as a playable attachment
  alongside the transcript. When OFF (default), audio is discarded
  immediately after transcription.
- **Capture component:** `<VoiceRecordButton>` at
  [src/components/voice/voice-record-button.tsx](../../src/components/voice/voice-record-button.tsx).
- **Default behaviour for admin/ops surfaces:** speech-to-text
  (transcript appended to the textarea body). This is the current
  behaviour and matches the Granola pattern. **Unchanged in v2.**
- **Default for cleaner PWA (later):** voice message attachment.
  Different default per surface, configured at the call site.

If we ever want a *third* lever — e.g. "STT enabled but only for
admins" or "STT enabled per-user" — we can add a new flag at that
point. We don't need it for the Granola redesign itself.

---

## 10. AI assist (later phase)

When the model selector is visible:

- Sending a message routes it through the AI SDK (`streamText` with
  `experimental_attachments`) instead of straight to Convex storage.
- Tool calls render via the existing chat-sdk message-parts renderer
  (see https://sdk.vercel.ai/docs/ai-sdk-ui/chatbot for the chatbot
  scaffolding patterns we'll follow).
- The composer stays the same — the surface decides whether to point
  `onSend` at "post message" or "ask AI".

This doc does not specify the AI surface in detail; that lives in
`Docs/ai-ops-assistant/` (to be created when that phase starts).

---

## 11. Implementation plan

All phases land on `feature/messages-granola-composer`, behind a new
`messages_granola_composer` runtime flag added to the existing
`featureFlags` table (so admins can A/B the new shape against the
current composer without a redeploy).

### Phase A — Pure extraction, no behaviour change (0.5 day)

1. Add `messages_granola_composer` flag to
   [convex/admin/featureFlags.ts](../../convex/admin/featureFlags.ts)
   and the schema literal union, plus FLAG_METADATA copy.
2. Extract the existing `<form>` composer block from
   `conversation-thread.tsx` into
   `src/components/conversations/chat-composer.tsx`. Pure JSX +
   handler move; no styling change.
3. Update `conversation-thread.tsx` to render `<ChatComposer />` with
   the same props it uses today.
4. **Verify:** messaging surface byte-identical to today's behaviour.
   Voice + video + send all work as before.

### Phase B — Granola shape behind the flag (1.5 days)

5. When `messages_granola_composer` is ON:
   - Wrap textarea + buttons in the pill tile (border, radius, padding).
   - Collapse mic + send into a single right-most slot with mic↔send swap.
   - Move video attach into a unified attach popover (paperclip).
   - Flip keyboard contract: `Enter` = newline, `Cmd/Ctrl+Enter` = send.
6. When the flag is OFF, render the current composer untouched. This
   is the safety harness while the new shape pilots internally.

### Phase C — Quick-action chips (0.5 day)

7. Add `chips?: ComposerChip[]` prop. Render a horizontal chip row
   above the textarea when present. Tapping fills the textarea or
   runs `onSelect`.
8. Define the property-thread chip set in code (en + es). Job thread
   reuses the same component with a different list.

### Phase D — Expand-to-fullscreen (0.5 day)

9. Add expand button + Radix `Sheet`. Renders the same composer plus
   the thread tail in a fullscreen overlay. Useful on mobile.

### Phase E — Cleaner PWA rollout (1 day)

10. Reuse `chat-composer.tsx` on the cleaner PWA chat with light-mode
    tokens. Hide expand button. Validate one-thumb reachability on
    iPhone SE.

### Phase F — AI assist (separate phase)

11. Show model selector behind a new `messages_ai_assist` flag.
12. Route `onSend` through AI SDK + AI Gateway.

---

## 12. Open questions

1. **Recording UX during voice → text:** show waveform + live partial
   transcript, or just timer + final transcript? Granola shows
   neither; ChatGPT shows live transcript. Recommendation: live
   transcript on desktop, timer-only on mobile.
2. **Drag-and-drop on desktop:** should dropping a file on the
   composer attach it? Yes — cheap and expected. Add in Phase B.
3. **Paste-image-from-clipboard:** support `paste` event with image
   data. Yes — also Phase B.
4. **Long messages:** at what character count do we soft-warn? The
   existing thread cap should rule. Confirm with messaging redesign track.
5. **Offline:** if Convex is offline, does the composer queue
   locally? Out of scope — matches existing offline behaviour of the
   messaging surface.

---

## 13. Cross-references

- Existing messages redesign plan: [PLAN.md](./PLAN.md), [prd-v1-chat.md](./prd-v1-chat.md)
- Photo upload pipeline (admin): [2026-04-04-photo-upload-architecture-admin-web.md](../2026-04-04-photo-upload-architecture-admin-web.md)
- Voice messages: [Docs/voice-messages/](../voice-messages/)
- Video support: [Docs/video-support/](../video-support/)
- Feature flags: [convex/admin/featureFlags.ts](../../convex/admin/featureFlags.ts), [src/lib/feature-flags.ts](../../src/lib/feature-flags.ts)
- Composer call site: [src/components/conversations/conversation-thread.tsx](../../src/components/conversations/conversation-thread.tsx)
- Voice capture: [src/components/voice/voice-record-button.tsx](../../src/components/voice/voice-record-button.tsx)
- Design tokens: [design-system/tokens/](../../design-system/tokens/)
- Component specs (cleaner PWA): [design-system/specs/](../../design-system/specs/)
- AI SDK docs (read before AI phase): https://sdk.vercel.ai/docs
- Chat SDK chatbot patterns: https://sdk.vercel.ai/docs/ai-sdk-ui/chatbot

---

## 14. Decisions confirmed (2026-04-30)

- [x] **Keyboard:** `Enter` = newline, `Cmd/Ctrl+Enter` = send. Behavior flip from today.
- [x] **Initial chip set:** placeholder values shipping in Phase C — "Confirm next clean", "Send arrival window", "Ask for photo of issue", "Mark complete & thank". Iterable post-launch.
- [x] **Voice default for admin composer:** speech-to-text (current behavior preserved). Cleaner PWA may default to voice-message later.
- [x] **STT admin on/off toggle:** already exists as `voice_messages` flag. **No new flag added.**
- [x] **Component path:** `src/components/conversations/chat-composer.tsx` (sibling of `conversation-thread.tsx`). **No new `messages/ChatComposer/` folder.**
- [x] **Pilot flag:** `messages_granola_composer` (new), added to existing `featureFlags` table. Default OFF.
