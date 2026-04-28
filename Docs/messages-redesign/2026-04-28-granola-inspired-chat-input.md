# Granola-Inspired Chat Input — Design & Implementation Doc

**Status:** Draft proposal
**Created:** 2026-04-28
**Owner:** Messaging redesign track
**Reference image:** Screenshot of Granola's chat input tile (composer with quick-action chips above the input row, mic button anchored bottom-right, paperclip attach, model selector, and "expand" affordance).

---

## 1. Goal

Replace the current chat input on the property/job messaging surface with a single, opinionated composer tile that mirrors the affordances we like in Granola:

- A pill-shaped input ("Ask anything") as the visual anchor.
- A row of **quick-action chips** sitting *above* the input (e.g. "Write follow-up", "List my todos", "All recipes"), used for prompt shortcuts.
- A single **trailing action cluster** inside the input on the right side, in this order, right-to-left:
  1. **Mic** (voice → speech-to-text, primary FAB-style circle).
  2. **Attach** (paperclip → opens unified picker for image / file).
  3. **Model / mode selector** ("Auto ▾").
- A small **expand-to-fullscreen** icon button at the top-right corner of the tile.

The microphone position is non-negotiable: it must be the right-most, most prominent control inside the input — the same thumb-zone position Granola uses.

---

## 2. Why this shape

| Need                                                | How the tile satisfies it                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Cleaners send most messages from a phone, one-thumb | Mic anchored bottom-right, large hit target                                                      |
| Photo-of-issue and document attach are core flows   | One paperclip → unified picker (image / file / camera), no separate buttons cluttering the input |
| Ops/admin sometimes want a "prompt" not a "message" | Quick-action chips above the input promote suggested prompts without taking input real estate   |
| Want a path to AI-assisted replies later            | "Auto ▾" model selector is a first-class slot — wired to AI SDK provider routing when we turn AI on |
| Feels like one product, not a chat box bolted on    | Single rounded tile, dark surface, soft outline, mirrors Granola's calm composer                 |

---

## 3. Anatomy

```
┌──────────────────────────────────────────────────────────────┐
│  [⎘ Write follow-up]  [⎘ List my todos]   [▦ All recipes] ⤢ │  ← chip row + expand
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Ask anything                          Auto ▾  📎  ◯🎙 │  │  ← input row
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Slots

| Slot                       | Purpose                                                   | Required? |
| -------------------------- | --------------------------------------------------------- | --------- |
| `chips`                    | 1–4 prompt shortcuts; horizontally scrollable on mobile   | Optional  |
| `expandButton`             | Opens the composer in a full-screen sheet                 | Optional  |
| `input`                    | Multiline textarea; auto-grows up to ~6 lines             | Required  |
| `modelSelector`            | Dropdown for model/mode. Hidden when AI is off            | Optional  |
| `attachButton`             | Single entry point to image/file/camera picker            | Required  |
| `micButton`                | Voice capture; long-press to record, tap to toggle        | Required  |
| `sendButton` (replaces mic when text is non-empty) | Sends the message; mic returns when input is cleared      | Required  |

The mic↔send swap is important: when the user has typed text, the right-most circle becomes a send button (paper plane). When the input is empty, it returns to the mic. This is how Granola, ChatGPT mobile, and WhatsApp behave — single thumb-zone slot, two states.

---

## 4. Component contract (TypeScript)

Place under [src/components/messages/](../../src/components/messages/) (working directory) — co-located with the existing message thread components.

```tsx
// src/components/messages/ChatComposer/ChatComposer.tsx

export type ComposerChip = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Inserted as the prompt body; if onSelect provided, takes precedence. */
  prompt?: string;
  onSelect?: () => void;
};

export type ComposerAttachment = {
  id: string;
  kind: "image" | "file" | "audio";
  name: string;
  sizeBytes: number;
  /** Local preview URL or remote storage URL. */
  url: string;
  uploadStatus: "pending" | "uploading" | "uploaded" | "failed";
  progress?: number; // 0..1
};

export type ChatComposerProps = {
  value: string;
  onChange: (next: string) => void;
  onSend: (payload: {
    text: string;
    attachments: ComposerAttachment[];
    voiceClip?: ComposerAttachment;
  }) => Promise<void> | void;

  attachments: ComposerAttachment[];
  onAttachFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;

  // Voice
  onStartRecording: () => void;
  onStopRecording: () => Promise<ComposerAttachment | null>;
  isRecording: boolean;

  // AI / model selector (optional — hidden when undefined)
  modelOptions?: Array<{ id: string; label: string }>;
  selectedModelId?: string;
  onSelectModel?: (id: string) => void;

  // Quick prompts
  chips?: ComposerChip[];

  // UX
  placeholder?: string;        // default: "Ask anything" / locale equivalent
  expandable?: boolean;        // shows expand-to-fullscreen icon
  onExpand?: () => void;
  disabled?: boolean;
  className?: string;
};
```

---

## 5. Behavior spec

### 5.1 Mic / send swap

```
text.length === 0 && attachments.length === 0  →  show Mic
otherwise                                      →  show Send (paper plane)
```

Tapping mic with empty input starts/stops recording. While recording, the input row shows a waveform + timer in place of the textarea, and the mic button becomes a stop button.

### 5.2 Attach button

A single tap opens a popover (desktop) or bottom sheet (mobile) with three options:

1. **Take photo** — `<input type="file" capture="environment" accept="image/*">`
2. **Choose photo** — `<input type="file" accept="image/*" multiple>`
3. **Choose file** — `<input type="file" multiple>`

This routes through the existing photo upload pipeline documented in [2026-04-04-photo-upload-architecture-admin-web.md](../2026-04-04-photo-upload-architecture-admin-web.md). Do **not** create a parallel pipeline.

### 5.3 Model selector ("Auto ▾")

- Hidden until the AI assist phase ships.
- When visible, opens a small popover: `Auto`, `Claude Sonnet 4.6`, `Claude Haiku 4.5`, `GPT-5`, etc.
- "Auto" routes through Vercel AI Gateway. Selecting a specific model pins that turn only.
- See AI SDK provider docs (https://sdk.vercel.ai/docs) and AI Gateway (https://vercel.com/docs/ai-gateway) before wiring.

### 5.4 Quick-action chips

- Tapping a chip calls `chip.onSelect?.()` if provided, otherwise sets the input value to `chip.prompt` and focuses the textarea.
- Chips are configurable per route (property chat vs job chat vs ops assistant).
- On mobile, the chip row scrolls horizontally and snaps to the leading edge.

### 5.5 Expand-to-fullscreen

- Top-right diagonal-arrows icon. Visible only when `expandable && onExpand`.
- Opens a full-screen `Sheet` (Radix dialog) with the same composer rendered larger and a thread-history pane above.
- Useful on mobile when typing long handovers.

### 5.6 Keyboard

| Key                  | Action                                                              |
| -------------------- | ------------------------------------------------------------------- |
| `Enter`              | Insert newline (because composer is multiline by default)           |
| `Cmd/Ctrl + Enter`   | Send                                                                |
| `Esc`                | Cancel recording or collapse expanded sheet                         |
| `Cmd/Ctrl + K`       | Focus the composer (global shortcut on messages pages)              |

### 5.7 Accessibility

- Mic and send buttons are `role="button"` with explicit aria-labels (`Record voice message`, `Send message`).
- Recording state announced via `aria-live="polite"` ("Recording, 0:08").
- Quick-action chips are a `role="toolbar"` with `aria-label="Suggested prompts"`.
- Min 44×44 pt hit targets on mobile per the cleaner PWA accessibility line in our design system.

---

## 6. Visual / token mapping

Use the unified design-system tokens at [design-system/tokens/](../../design-system/tokens/) — never hard-code colors.

| Surface                          | Admin (dark)                             | Cleaner PWA (light)                      |
| -------------------------------- | ---------------------------------------- | ---------------------------------------- |
| Tile background                  | `surface.elevated` (~`oklch(0.22 0 0)`) | `surface.card` (white)                   |
| Tile border                      | `border.subtle`                          | `border.subtle`                          |
| Input border (focus)             | 1px `accent.primary` outer ring          | 1px purple primary ring                  |
| Mic button                       | Filled circle, `surface.muted`           | Filled circle, `surface.muted`           |
| Send button (active)             | Filled circle, `accent.primary`          | Filled circle, purple primary            |
| Recording pulse                  | `state.danger` 60% opacity halo          | same                                     |
| Chip                             | Pill, `surface.muted` bg, 1px border     | same                                     |
| Chip icon                        | 16px, `text.muted`                       | same                                     |

Border radius: tile `2xl`, input `xl`, chips `full`. Shadow: none — rely on border + surface contrast (Granola does the same).

Density:

- Tile padding: `p-3` mobile / `p-4` desktop.
- Input row vertical padding: `py-2.5`.
- Chip row gap: `gap-2`.

---

## 7. Where it plugs in

| Surface                                     | Replaces                                                       |
| ------------------------------------------- | -------------------------------------------------------------- |
| Property messaging (admin)                  | `<MessageInput>` in [src/app/(dashboard)/messages/](../../src/app/(dashboard)/messages/) |
| Job thread                                  | The inline composer at the bottom of job detail                |
| Cleaner PWA chat (`/cleaner` routes)        | The current bottom composer; styling switches to light-mode tokens |
| Future: ops AI assistant                    | First and only composer; chips + model selector both visible  |

The **same component** ships to all four surfaces. Differences are configuration:

| Surface             | `chips`             | `modelSelector` | `expandable` | Theme  |
| ------------------- | ------------------- | --------------- | ------------ | ------ |
| Property messaging  | property prompts    | hidden          | yes          | dark   |
| Job thread          | job prompts         | hidden          | yes          | dark   |
| Cleaner chat        | cleaner prompts     | hidden          | no           | light  |
| Ops AI assistant    | assistant prompts   | visible         | yes          | dark   |

---

## 8. State management

The composer is **stateless about transport**. It owns:

- Local `value` (uncontrolled fallback if no `value` prop).
- `attachments[]` lifecycle while staged.
- Recording state machine: `idle → requesting-permission → recording → finalizing → idle`.

It does **not** call Convex directly. All persistence flows through hooks already in the messaging code:

- `useSendMessage(threadId)` — wraps the existing Convex mutation.
- `useUploadAttachment()` — wraps the existing storage upload action.
- `useTranscribeAudio()` — *new*, wraps the speech-to-text action (see §10).

Per OpsCentral rule: **all business logic lives in Convex**. The composer is UI only.

---

## 9. Voice → text pipeline

Two modes, configured per surface:

1. **Voice message** (default for cleaner PWA): the recording is uploaded as an audio attachment (existing voice-messages flow at [Docs/voice-messages/](../voice-messages/)). No transcription; played back inline.
2. **Speech-to-text** (default for ops/admin): the recording is transcribed and the transcript is inserted into the input as editable text. Audio is discarded after transcription unless the user chooses "send as voice".

A small toggle in the recording overlay switches between the two for that turn. The default is per-surface configuration, not user preference, to keep behavior predictable.

Provider choice for STT will follow the AI SDK pattern (https://sdk.vercel.ai/docs) and route through AI Gateway. Confirm provider/model before implementation — do not assume current SDK signatures.

---

## 10. AI assist (later phase)

When the model selector is visible:

- Sending a message routes it through the AI SDK (`streamText` with `experimental_attachments`) instead of straight to Convex storage.
- Tool calls render via the existing chat-sdk message-parts renderer (see https://sdk.vercel.ai/docs/ai-sdk-ui/chatbot for the chatbot scaffolding patterns we'll follow).
- The composer itself stays the same — the surface decides whether to point `onSend` at "post message" or "ask AI".

This doc does not specify the AI surface in detail; that lives in [Docs/ai-ops-assistant/](../ai-ops-assistant/). Cross-link when that phase starts.

---

## 11. Implementation plan

### Phase A — Component shell (1–2 days)

1. Scaffold `ChatComposer` with input, mic, attach, send swap, chips row, expand button.
2. Wire to existing `useSendMessage` / `useUploadAttachment` hooks behind a feature flag (`composer.granola_v1`).
3. Storybook entries for: empty, typing, with attachments, recording, expanded, with chips, with model selector.

### Phase B — Pilot on property messaging (admin, dark) (1 day)

4. Replace the existing input on the property messaging page only.
5. Tokens-only theming; no hard-coded colors.
6. A11y audit (focus order, aria labels, keyboard shortcuts).

### Phase C — Cleaner PWA rollout (light theme) (1 day)

7. Pass light-theme tokens; hide expand button.
8. Validate one-thumb reachability on iPhone SE class device.

### Phase D — Quick-action chips per surface (0.5 day)

9. Define the prompt sets per surface (property, job, cleaner, ops).
10. Localize strings (en/es).

### Phase E — AI assist (separate phase, see ai-ops-assistant)

11. Show model selector.
12. Route `onSend` through AI SDK + AI Gateway.

---

## 12. Open questions

1. **Recording UX during voice → text:** show waveform + live partial transcript, or just timer + final transcript? Granola shows neither; ChatGPT shows live transcript. Recommendation: live transcript on desktop, timer-only on mobile (to save bandwidth and CPU).
2. **Drag-and-drop on desktop:** should dropping a file on the composer attach it? Yes — cheap and expected. Add in Phase A.
3. **Paste-image-from-clipboard:** support `paste` event with image data. Yes — also Phase A.
4. **Long messages:** at what character count do we soft-warn? Existing thread cap should rule. Confirm with messaging redesign track.
5. **Offline:** if Convex is offline, does the composer queue locally? Out of scope for this doc — matches existing offline behavior of the messaging surface.

---

## 13. Cross-references

- Existing messages redesign plan: [PLAN.md](./PLAN.md), [prd-v1-chat.md](./prd-v1-chat.md)
- Photo upload pipeline (admin): [2026-04-04-photo-upload-architecture-admin-web.md](../2026-04-04-photo-upload-architecture-admin-web.md)
- Voice messages: [Docs/voice-messages/](../voice-messages/)
- Video support: [Docs/video-support/](../video-support/)
- Design tokens: [design-system/tokens/](../../design-system/tokens/)
- Component specs (cleaner PWA): [design-system/specs/](../../design-system/specs/)
- AI SDK docs (read before AI phase): https://sdk.vercel.ai/docs
- Chat SDK chatbot patterns: https://sdk.vercel.ai/docs/ai-sdk-ui/chatbot

---

## 14. Decision needed before build

- [ ] Confirm chip set for each surface.
- [ ] Confirm voice default per surface (voice message vs speech-to-text).
- [ ] Confirm model selector is hidden until AI assist phase.
- [ ] Confirm tile lives in `src/components/messages/ChatComposer/` (not in `chat/`), to keep messaging components co-located.
