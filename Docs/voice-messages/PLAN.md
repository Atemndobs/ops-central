# Voice Messages — Feature Plan

**Status:** Draft for discussion
**Date:** 2026-04-23
**Owner:** TBD
**Scope:** Both admin web (OpsCentral) and cleaner PWA, shared Convex backend
**Feature flag:** `voice_messages` — see `Docs/feature-flags/PATTERN.md`.
Default OFF. Admins flip it on from Settings → Integrations → Feature Flags
once the feature is ready for their users.

---

## 1. Problem / Use Case

A cleaner is mid-job — gloves on, hands wet, phone mounted nearby — and a message
comes in from ops ("did you refill coffee pods?"). Typing a reply is friction.

**Desired flow:**
1. Tap the mic button in the composer.
2. Speak: "Yes, refilled two boxes, also noticed the kettle is cracked."
3. Release / tap stop.
4. Transcript appears in the composer text field.
5. Tap send (or auto-send, configurable).

**Secondary use case (admin side):** property_ops dictating a longer instruction
to a cleaner instead of typing it.

**Non-goals (for v1):**
- Voice *notes* (sending the raw audio as a playable message) — we only send
  the *transcript*. We can add audio-as-attachment in v2.
- Live captioning during recording.
- Wake-word / hands-free ("hey ja, reply...").

---

## 2. Key Constraints

| Constraint | Implication |
|---|---|
| **Bilingual (en/es)** | STT must auto-detect or support both. We already store `sourceLang` on messages. |
| **Mobile-first, on-the-go** | Must work on iOS Safari PWA (primary cleaner surface). |
| **Shared Convex backend** | Transcription action should live in `convex/` so both apps reuse it. |
| **Cost sensitivity** | Cleaners generate lots of short clips. Per-minute cost matters. |
| **Privacy** | Cleaner voices are worker data — choose provider with no training-on-data. |

---

## 3. Architecture Options

### Option A — Browser-native Web Speech API (free, zero backend)
- `SpeechRecognition` / `webkitSpeechRecognition` runs on-device (or Google cloud on Chrome).
- **Pros:** Free, instant, streaming, no API key, no Convex change.
- **Cons:**
  - Safari/iOS support landed but is quirky — often defers to Siri dictation anyway.
  - Accuracy varies by device; no control over model.
  - No file record we can archive later.
  - Locale must be set explicitly (`lang = 'en-US' | 'es-MX'`) — no auto-detect.

### Option B — Record audio → server-side transcription (recommended)
- Client records via `MediaRecorder` → uploads blob → Convex action sends to a
  transcription provider.
- Providers to pick between:
  | Provider | Model | Price | Notes |
  |---|---|---|---|
  | **Google Gemini (free tier)** | `gemini-2.5-flash` | $0 within limits | Native audio input, bilingual auto-detect, ~15 RPM / ~1500 RPD free. Free-tier inputs *may* be used to improve Google products. |
  | **Google Gemini (paid tier)** | `gemini-2.5-flash` | ~$0.001/min equivalent | No training on data, higher rate limits. Drop-in upgrade. |
  | **OpenAI** | `whisper-1` | $0.006/min | Gold standard, bilingual auto-detect |
  | **Groq** | `whisper-large-v3-turbo` | ~$0.0007/min | ~10× cheaper than OpenAI, very fast |
  | **Deepgram** | `nova-3` | $0.0043/min | Streaming, es is weaker |

  **Recommendation — Gemini free tier first, paid upgrade when we grow.**
  Aligns with existing J&A standard ("Use Gemini for AI features", per team
  preference). Zero cost at current scale. When we hit rate limits or need
  the stricter data-retention posture, flip the same API key to paid tier —
  no code changes, same endpoint, same model name.

- **Pros:** Free at our scale, same Google stack we already use, bilingual
  auto-detect, Gemini can *also* reason about the audio (e.g. clean up
  filler words, extract intent) — a capability Whisper lacks.
- **Cons:**
  - Free-tier rate limits (~15 RPM / ~1500 RPD) — risk on shift-change bursts.
  - Free-tier privacy caveat (data may train Google models). Acceptable for
    MVP because transcripts are short work chatter, not sensitive PII. We
    upgrade to paid the moment we onboard outside-J&A customers.
  - Slightly higher latency than Groq (~1–3s vs ~0.5–1s).

### Option C — Hybrid (v2 consideration)
Use browser STT for instant local preview, then swap with server transcript when
ready. More complexity than it's worth for v1.

**Decision for v1:** **Option B with Gemini 2.5 Flash (free tier)**, record
client-side with `MediaRecorder`, transcribe via Convex action, drop the audio
blob after success (store later if we add audio-message feature).

**Fallback / upgrade path:** If Gemini free-tier rate limits bite, or we need
the no-training guarantee, swap the same endpoint to paid tier (one env var
change). Groq Whisper remains a valid secondary fallback on 5xx.

---

## 4. Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Client (web or PWA)                                        │
│  1. User taps mic → getUserMedia({ audio: true })           │
│  2. MediaRecorder captures webm/opus or mp4/aac chunks      │
│  3. User stops → Blob assembled                             │
│  4. Upload blob → Convex storage (via generateUploadUrl)    │
│  5. Call action: transcribeVoice({ storageId, lang? })      │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Convex action: conversations.voice.transcribe              │
│  6. Fetch audio from storage                                │
│  7. Call Gemini generateContent with audio part +           │
│     prompt: "Transcribe verbatim. Return JSON              │
│     { text, language }."                                    │
│  8. Return { text, detectedLang, durationMs }               │
│  9. Schedule deletion of storage blob (ttl 5 min) OR delete │
│     immediately after success                               │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Client                                                     │
│  10. Populate composer textarea with transcript             │
│  11. User reviews / edits / hits Send                       │
│  12. Existing sendMessage mutation fires (unchanged)        │
└─────────────────────────────────────────────────────────────┘
```

**Why upload instead of pass audio directly to action?** Convex actions have
request body limits (~1 MB). A 30s clip can exceed that. Storage upload sidesteps
the limit and works identically in both apps.

---

## 5. UX Design

### Composer changes (both apps)
- Add mic button between attachment icon and Send button.
- **States:**
  - `idle` → mic icon (neutral)
  - `recording` → red pulsing dot + waveform + elapsed timer + stop button + cancel (X)
  - `transcribing` → spinner "Transcribing…"
  - `ready` → transcript in textarea, mic back to idle, user can edit & send

### Interaction model — choose one
- **Push-and-hold** (WhatsApp-style): hold mic, release to send/transcribe.
  Natural on mobile, awkward on desktop.
- **Tap-to-start / tap-to-stop** (recommended):
  tap to start, tap stop (or auto-stop after silence). Works on both.
- Add a **Cancel** action (swipe-left on mobile, X button on desktop) to abort.

### Max duration
Cap at **60 seconds** v1. If a cleaner wants to dictate a novel, that's a v2 problem.
Show countdown at 50s.

### Permission prompt
First use triggers the browser mic permission dialog. If denied → show a friendly
toast: "Enable microphone in browser settings to use voice replies."

### Accessibility
- Button must have `aria-label` that updates per state.
- Provide keyboard shortcut (e.g. `Cmd+Shift+V`) on desktop.
- Visible text alternative ("Tap to record") for screen readers.

---

## 6. Convex Backend Additions

### New files
```
convex/
├── conversations/
│   └── voice.ts         # action: transcribe
└── schema.ts            # (no changes for v1)
```

### New action signature
```ts
// convex/conversations/voice.ts
// NOTE: exact Gemini SDK API surface must be verified against
// https://ai.google.dev/gemini-api/docs before implementation —
// training data for this SDK is known to drift.
export const transcribe = action({
  args: {
    storageId: v.id("_storage"),
    languageHint: v.optional(v.union(v.literal("en"), v.literal("es"))),
  },
  returns: v.object({
    text: v.string(),
    detectedLang: v.string(),
    durationMs: v.number(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new Error("Audio not found");

    const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
    const prompt = `Transcribe the audio verbatim. Detect language (en or es).
Return ONLY valid JSON: {"text": "...", "language": "en" | "es"}.`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: blob.type || "audio/webm", data: base64 } },
            ],
          }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) throw new Error(`Transcription failed: ${res.status}`);
    const json = await res.json();
    const parsed = JSON.parse(json.candidates[0].content.parts[0].text);

    await ctx.storage.delete(args.storageId);

    return {
      text: parsed.text,
      detectedLang: parsed.language ?? args.languageHint ?? "en",
      durationMs: 0, // Gemini doesn't return duration; compute client-side if needed
    };
  },
});
```

### Env vars
- `GEMINI_API_KEY` → set in Convex dashboard (both deployments). Free tier to start; swap to paid-tier key later without code change.
- Optional `GROQ_API_KEY` → fallback on Gemini 5xx or rate-limit errors.

### Auth / rate limiting
- Require authenticated identity.
- Rate limit per user: e.g. 60 transcriptions / hour (prevent abuse / runaway cost).
- Log each call with user + duration to Convex `posthog/analytics` for monitoring.

---

## 7. Client Implementation Sketch

### New shared hook
```
src/hooks/use-voice-recorder.ts
```
Returns `{ state, startRecording, stopRecording, cancel, transcript, error }`.
Wraps `MediaRecorder`, upload URL fetch, and the transcribe action call.

### New component
```
src/components/voice/voice-record-button.tsx
```
Self-contained button that accepts `onTranscript(text: string)` callback.
Drop-in use: `<VoiceRecordButton onTranscript={(t) => setBody(b => b + t)} />`.

### Integration point (web)
`src/components/conversations/conversation-thread.tsx:388` — add the button next
to the textarea inside the existing `<div className="flex items-end gap-2">`.

### Integration point (mobile PWA)
Same composer lives under `src/app/cleaner/messages/…` — reuse the same component
since PWA is web.

---

## 8. Cost Model

Assume 50 active cleaners × 5 voice replies/day × 15s avg = **62.5 minutes/day**,
**~250 requests/day**.

| Provider | Monthly cost (30 days) | Within limits? |
|---|---|---|
| **Gemini 2.5 Flash (free)** | **$0** | ✅ 250/day ≪ 1500/day limit |
| Gemini 2.5 Flash (paid) | ~$2 | ✅ no hard cap |
| Groq Whisper | ~$1.30 | ✅ |
| OpenAI Whisper | ~$11.25 | ✅ |

**Free-tier headroom:** we can grow ~6× before hitting the 1500 RPD ceiling.
Burst risk: if 20 cleaners trigger simultaneously at shift change, we could
briefly exceed 15 RPM — mitigation is a client-side queue (retry with
exponential backoff) and eventual upgrade to paid tier.

---

## 9. Phased Rollout

### Phase 1 — MVP (cleaner app only)
- Voice button in cleaner composer.
- **Gemini 2.5 Flash free tier**, en+es auto-detect.
- Transcript into textarea, user reviews & sends manually.
- 60s cap, tap-to-start/stop.
- No audio retention.
- Monitor PostHog for RPM spikes — upgrade to paid tier if we approach limits.

### Phase 2 — Admin web + polish
- Same component in admin composer.
- Waveform visualization during recording.
- Keyboard shortcut on desktop.
- Rate limiting dashboard in PostHog.

### Phase 3 — Audio attachments (optional)
- Keep the audio blob; attach it alongside the transcript as a playable message
  part. New attachment kind `"audio"` in schema.
- Useful when transcript fails or tone matters.

### Phase 4 — Language-aware send
- Detected lang feeds into existing translation pipeline. If cleaner speaks es
  and recipient locale is en, show translated preview before send.

---

## 10. Open Questions (for discussion)

1. **Push-and-hold vs tap-to-toggle** — which default feels right? (I lean tap.)
2. **Auto-send after transcription** — off by default, but should we offer a
   setting "auto-send voice replies" for power users?
3. **Silence detection** — auto-stop after 2s of silence, or always manual stop?
4. **Store audio?** I say no for v1 (privacy + cost). Revisit in Phase 3.
5. **Groq vs OpenAI** — Groq for cost, but we already have OpenAI for AI chat
   features. Do we want one vendor or best-of-breed per task?
6. **Language hint** — should we pass the user's UI locale as a hint to boost
   accuracy, or always let Whisper auto-detect?
7. **Offline behavior** — if the cleaner is in a dead zone, do we queue the
   audio blob and transcribe when back online, or just show "no connection"?
   (Queuing matches the existing mobile offline-first vibe but adds complexity.)

---

## 11. What We Need From You

- ✅ **Gemini free tier confirmed as v1 provider** (per 2026-04-23 discussion).
- Decision on push-and-hold vs tap-to-toggle.
- `GEMINI_API_KEY` (free tier from Google AI Studio) provisioned on Convex (both deployments).
- Greenlight to start Phase 1 against a feature branch (`feature/voice-messages`).

---

## 12. Admin-Configurable Provider (§new)

Admins must be able to switch the transcription provider/tier at runtime from the
Settings page — **no redeploy, no env var edit**.

### Curated shortlist (not "every model Google offers")
The picker exposes **only** the options below. Adding a new one requires a code
change (keeps the blast radius small).

| Key | Label | Cost | When to pick |
|---|---|---|---|
| `gemini-flash-free` | **Gemini 2.5 Flash — Free** | $0 | Default. MVP / internal J&A use. |
| `gemini-flash-paid` | **Gemini 2.5 Flash — Paid** | ~$0.001/min | No-training guarantee, higher RPM. Pick before onboarding outside customers. |
| `groq-whisper-turbo` | **Groq Whisper v3 Turbo** | ~$0.0007/min | Fastest latency, cheapest paid option, Whisper accuracy. |
| `openai-whisper` | **OpenAI Whisper** | $0.006/min | Reliability fallback if others have issues. |

Each entry hardcodes: provider endpoint, model name, and which `*_API_KEY` env
var it reads. Admin only chooses the **key**; the server does the rest.

### Where config lives — Convex table

```ts
// convex/schema.ts — NEW table
aiProviderSettings: defineTable({
  feature: v.literal("voice_transcription"), // extensible for future AI features
  providerKey: v.union(
    v.literal("gemini-flash-free"),
    v.literal("gemini-flash-paid"),
    v.literal("groq-whisper-turbo"),
    v.literal("openai-whisper"),
  ),
  updatedBy: v.id("users"),
  updatedAt: v.number(),
}).index("by_feature", ["feature"]),
```

Single row per feature. Seed with `gemini-flash-free` on first deploy.

### Server-side dispatch
```
convex/ai/providers.ts            NEW — registry mapping key → { transcribe() }
convex/conversations/voice.ts     MODIFIED — reads current key, delegates to registry
convex/ai/settings.ts             NEW — query (public) + mutation (admin-only)
```

The `transcribe` action becomes a thin router:
```ts
const setting = await ctx.runQuery(api.ai.settings.getVoiceProvider);
const provider = PROVIDERS[setting.providerKey];
return provider.transcribe(blob, args.languageHint);
```

### Admin UI
New section on `/settings` → **"AI Providers"**:
- Card titled "Voice Transcription"
- Dropdown with the 4 options, current cost/min shown inline
- Read-only status chip: current usage this month, last error (if any)
- Save button → mutation (role-gated to `admin` only)
- Change log visible: "Switched to Gemini Paid by Bertrand on 2026-05-10"

### Safety rails
- Mutation rejects the change if the corresponding `*_API_KEY` env var is missing
  → returns a clear error "OPENAI_API_KEY not configured on server".
- Only `admin` role can write; `property_ops` and below get a read-only view.
- Rate-limit the mutation (1 change / 10 sec) to prevent toggle spam.
- Optional: add a "Test transcription" button that runs a 2s sample clip against
  the currently-selected provider before saving — catches misconfigurations.

### Observability
Every transcribe call logs to PostHog with `providerKey` as a property →
dashboard shows cost-per-provider and error rate side-by-side, so the admin
has data when deciding to switch.

---

## 13. Feature-flag gate (§new — adopt as standard)

Voice messaging is shipped behind a `voice_messages` entry in the shared
`featureFlags` table. The mic button renders only when an admin has
explicitly enabled the flag from **Settings → Integrations → Feature Flags**.

Rationale:
- **Ship-dark default.** New user-facing features should never appear in
  production the moment they merge. An admin flips them on when ready.
- **Kill switch.** If voice transcription burns through free-tier quota,
  surfaces an embarrassing bug, or a provider dies, admin can turn it off
  from the UI in seconds — no redeploy.
- **Same pattern everywhere.** Theme switcher, voice messages, AI ops
  assistant, anything new — all gated the same way. No special cases.

**Implementation in this PR:**
- `voice_messages` added to the `featureFlags.key` union in `convex/schema.ts`.
- Matching metadata entry in `convex/admin/featureFlags.ts` → `FLAG_METADATA`.
- `conversation-thread.tsx` calls `api.admin.featureFlags.isFeatureEnabled`
  with `{ key: "voice_messages" }` and wraps the `<VoiceRecordButton>` in
  a conditional.

**Note:** the `AIProviderCard` on Settings is NOT gated — admins need access
to configure providers *before* flipping the voice flag on, otherwise the
first voice recording would fail for lack of a selected provider.

---

## 14. File Map (what we'll add/change)

```
Docs/voice-messages/
├── PLAN.md                          (this file)
└── wireframes/                      (to add)

convex/
├── ai/
│   ├── providers.ts                 NEW — registry of the 4 curated providers
│   └── settings.ts                  NEW — query + admin-only mutation
├── conversations/
│   └── voice.ts                     NEW — transcribe action (delegates to registry)
└── schema.ts                        MODIFIED — aiProviderSettings table

src/
├── hooks/
│   └── use-voice-recorder.ts        NEW — MediaRecorder + upload + action
├── components/
│   ├── voice/
│   │   └── voice-record-button.tsx  NEW — drop-in button
│   ├── settings/
│   │   └── ai-provider-card.tsx     NEW — provider picker card
│   └── conversations/
│       └── conversation-thread.tsx  MODIFIED — add button to composer
├── app/(dashboard)/settings/
│   └── page.tsx                     MODIFIED — mount AI provider card
└── messages/
    ├── en.json                      MODIFIED — voice.* + settings.aiProvider.* strings
    └── es.json                      MODIFIED — voice.* + settings.aiProvider.* strings
```
