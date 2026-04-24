# Bilingual Content Translation Plan (EN ↔ ES)

**Date:** 2026-04-21
**Branch:** `codex/cleaner-rollout-quick-wins-saas-plan`
**Status:** Plan — pending execution
**Owner:** Bertrand
**Pairs with:** [2026-04-20-cleaner-rollout-quick-wins-and-testing-plan.md](2026-04-20-cleaner-rollout-quick-wins-and-testing-plan.md) — implements cross-language access for the rollout's "access instructions" and "messaging" pillars.

---

## Goal

Cleaners on the field write/read in **Spanish**. Ops and managers in the office write/read in **English**. The product translates user-generated content automatically so each role sees content in their own language without anyone having to think about it.

Two surfaces are in scope:

1. **Property instructions** — admins author in EN; cleaners read in ES (and vice-versa).
2. **Conversation messages** — cleaners send in ES; ops/managers read in EN; ops replies in EN; cleaners read in ES.

UI translations (button labels, headings) are already handled by `next-intl` and are out of scope for this plan.

---

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| Provider | **Gemini 2.0 Flash via Google AI API (free tier)** | Free tier covers 15 RPM / 1M tokens/day — easily covers pilot volume. Aligns with prior preference (use Gemini for AI features). Single SDK across translation + future AI tasks. |
| Languages (v1) | **EN ↔ ES only**, schema extensible (`translations: Record<Locale, …>`) | Keeps surface small for pilot. Schema lets us add `fr`, `pt` later without migration. |
| Cost gate (env opt-in) | **Not required** — Gemini free tier covers expected volume | Pilot volume estimated < 50K tokens/day. If we exceed free tier later, gate becomes a follow-up. |
| Property instructions: when | **Translate on write** | Low volume, instant reads, simpler client. Re-translate when admin edits source. |
| Messages: when | **Translate on read, cached** | Higher volume; some messages never read in opposite language. Cache result on the message doc to avoid repeat calls. |
| Editing UX (instructions) | **Side-by-side EN + ES inputs** with "Auto-translate" button | Admin sees what a cleaner sees; can hand-correct ES if AI gets a domain term wrong (e.g. "Hot tub" → "Jacuzzi" preference). |
| Source language detection (messages) | **Trust sender's UI locale** as `sourceLang` on save | Fast, free, deterministic. If sender writes in the wrong language by accident, recipient sees the original (with "Show original" toggle) and can flag. |
| Recipient UX (messages) | **Show translated by default**, small "Show original" toggle (Slack/Teams pattern) | Reduces cognitive load. Toggle preserves context when translation is ambiguous. |
| Scope | **Both A (instructions) and B (messages) ship together** under this plan, in two commits | One commit per surface for clean review and rollback. |

---

## Architecture

### Shared translation module

```
convex/lib/translation.ts          (pure helper — fetch wrapper around Gemini)
convex/translation/actions.ts      (Convex action: translateText, translateBatch)
convex/translation/internal.ts     (internal mutations called by translation actions)
```

- Uses `process.env.GEMINI_API_KEY` (Convex deployment env var). Set via `npx convex env set GEMINI_API_KEY <key>` against `dev:usable-anaconda-394`.
- Single function: `translateText(text: string, sourceLang: Locale, targetLang: Locale): Promise<string>`.
- Prompt is short and deterministic ("Translate the following from <src> to <tgt>. Keep tone, preserve any line breaks. Return only the translation, no commentary.").
- Returns the target string. On failure, throws — caller decides whether to fall back to source.

### Schema additions

**`properties.instructions[*]`** (extend the existing array element shape):

```ts
v.object({
  id: v.string(),
  category: v.union( ... ),                    // unchanged
  title: v.string(),                           // source — admin's input
  body: v.string(),                            // source
  sourceLang: v.optional(v.union(v.literal("en"), v.literal("es"))),  // defaults to "en"
  translations: v.optional(
    v.record(
      v.union(v.literal("en"), v.literal("es")),
      v.object({ title: v.string(), body: v.string() }),
    ),
  ),
  updatedAt: v.number(),
})
```

**`conversationMessages`** (existing table — add 2 fields):

```ts
sourceLang: v.optional(v.union(v.literal("en"), v.literal("es"))),  // sender's UI locale at send time
translations: v.optional(
  v.record(
    v.union(v.literal("en"), v.literal("es")),
    v.string(),
  ),
),
```

Both are optional — backwards compatible with existing rows. Rows without `sourceLang` are treated as the original language (no translation attempted).

### Mutation/action flow

**A — Property instructions (write-side):**

```
admin saves instruction
    ↓
mutation: addInstruction / updateInstruction
    - writes source title/body + sourceLang
    - schedules action (ctx.scheduler.runAfter(0, ...))
    ↓
action: translateInstruction
    - calls Gemini for the missing target language
    - calls internal mutation to patch instruction.translations[targetLang]
    ↓
cleaner UI sees translation appear within ~1s (Convex reactive subscription)
```

**B — Messages (read-side):**

```
sender writes message in their UI locale
    ↓
mutation: sendMessage
    - stores body + sourceLang (= sender's locale)
    ↓
recipient opens conversation
    ↓
client query returns messages
    ↓
for each message where myLocale !== sourceLang AND translations[myLocale] missing:
    - client calls action: translateMessage(messageId, myLocale)
    - action: gemini → patch message.translations[myLocale]
    ↓
UI re-renders with translated body (cached for next viewer)
```

Caching means each message is translated **at most once per target language**, regardless of how many recipients view it.

---

## Implementation phases

### Phase A — Property instructions (commit 1)

1. Set `GEMINI_API_KEY` in Convex dev env.
2. Add `convex/lib/translation.ts` (Gemini fetch wrapper).
3. Add `convex/translation/actions.ts` with `translateText` action.
4. Extend `properties.instructions` schema with `sourceLang` + `translations`.
5. Update `addInstruction` / `updateInstruction` mutations to:
   - Default `sourceLang = "en"` (admin is English-locale).
   - Schedule `translateInstructionAction` for the opposite language.
6. New internal mutation `setInstructionTranslation(propertyId, instructionId, lang, { title, body })`.
7. Re-seed `seedInstructionsByName` so demo data has Spanish translations populated.
8. Update [`property-instructions-panel.tsx`](src/components/properties/property-instructions-panel.tsx):
   - Show side-by-side EN + ES textareas in edit/add forms.
   - "Auto-translate to Spanish" button below EN body — calls action, fills ES inputs.
   - Save persists both versions; if ES is empty, fall back to scheduled translation.
9. Update [`cleaner-property-detail-client.tsx`](src/components/cleaner/cleaner-property-detail-client.tsx) `InstructionsBlock`:
   - Read `instruction.translations[locale] ?? { title: instruction.title, body: instruction.body }`.
10. Smoke test: edit an instruction in EN admin, see ES update on cleaner page within ~1s.

### Phase B — Conversation messages (commit 2)

1. Extend `conversationMessages` schema with `sourceLang` + `translations`.
2. Update send mutation to record `sourceLang` from caller's locale (pass from client; default to user's profile locale).
3. New action `translateMessage(messageId, targetLang)` — idempotent: no-op if translation already cached.
4. Update [`conversation-thread.tsx`](src/components/conversations/conversation-thread.tsx) message renderer:
   - If `sourceLang !== myLocale` and `translations[myLocale]` exists → display translated.
   - If missing → call action on mount (debounced), display source as placeholder until translation arrives.
   - Add small "Show original" / "Mostrar original" toggle below the message body.
5. Same treatment in any other message-rendering component (job conversations panel, inbox preview).
6. Smoke test: cleaner sends ES message; ops sees EN with toggle to original ES.

---

## Cost & rate-limit notes

- Gemini 2.0 Flash free tier: **15 RPM, 1M tokens/day**.
- Estimated pilot volume: ~50 messages/day × ~30 tokens each × 1 translation = 1.5K tokens/day. ~50 instruction edits/week × 100 tokens × 1 translation = 5K tokens/week. Well under free tier.
- If we exceed free tier (e.g. 100+ active cleaners), upgrade to paid Gemini Flash — same code path, just billing.
- Gemini API errors (rate limit, network): translation falls back to source text + a small inline warning. No data loss.

---

## Risks & open questions

- **Domain terms:** AI may translate "hot tub" / "checkout" inconsistently. Mitigation: side-by-side editing lets admin override. Future: glossary file injected into the prompt.
- **PII in messages:** Messages may contain guest names, codes, addresses. Sending to Gemini = sending to Google. Confirm with Bertrand before going live whether this is acceptable for the pilot. If not, options: self-hosted LibreTranslate, or DeepL Free (also 500K chars/month).
- **Translation drift:** If admin edits the EN source and the auto ES is stale (admin didn't click re-translate), cleaner sees outdated ES. Mitigation: invalidate `translations[es]` on every source edit, forcing schedule of fresh translation.
- **Latency on messages:** First viewer in opposite locale waits ~500ms for translation. Subsequent viewers see it instantly (cached). Acceptable for chat; consider showing "Translating…" placeholder.
- **Multi-device race:** Two ops viewing the same untranslated ES message simultaneously could trigger 2 actions. Action is idempotent (checks `translations[targetLang]` first inside Convex transaction), so safe but slightly wasteful. Acceptable.

---

## Out of scope (future)

- Voice messages translation (transcribe → translate → display).
- Inline translation edit by recipient (e.g. cleaner suggests a better Spanish phrasing for an admin-authored instruction).
- Translation memory / glossary across the org for consistency.
- Detection of source language when sender's profile locale is wrong.
- Languages beyond EN/ES (FR, PT planned per SaaS roadmap).

---

## Acceptance criteria

- Admin types an instruction in English, saves; cleaner reloads property page within 5s and sees ES title/body.
- Admin can manually edit the ES side-by-side and save; cleaner sees admin's manual ES (not Gemini's).
- Cleaner sends "Hola, ya estoy aquí" in conversation; ops opens thread and sees "Hello, I'm here now" with a "Show original" toggle.
- Toggling "Show original" reveals the ES message; toggling again restores the EN translation.
- No translation calls are made when sender and recipient share the same locale.
- Re-opening the conversation later does not re-translate (cache hit).

---

## Rollback

- Set `GEMINI_API_KEY=""` in Convex env → translation actions throw → UI falls back to source language. No crashes; users see whatever the sender wrote.
- Schema additions are optional fields — safe to leave in place even if disabled.
- To fully revert: `git revert <translation commits>`; schema fields become unused but harmless.
