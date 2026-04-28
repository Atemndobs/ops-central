# ADR 0001: Extend `photos` table with a `mediaKind` discriminator

## Status

Proposed — 2026-04-26

## Context

Today the canonical Convex model is documented in [2026-04-04-canonical-photo-model-adr.md](../../2026-04-04-canonical-photo-model-adr.md): every cleaner-originated photo resolves to a single `photos` row, and incidents reference `photos` rather than `_storage` IDs directly. Schema lives at `convex/schema.ts:701-735`.

We now need to attach **video** to the same surfaces (jobs, incidents, conversations, properties, checkpoints). Three reasonable shapes exist:

1. **Sibling `videos` table** — mirror of `photos` with duration/poster fields.
2. **New unified `media` table** — rename `photos`, migrate all data, polymorphic over image/video.
3. **Extend `photos` with a `mediaKind` discriminator** — add optional video columns, keep table name and indexes.

`conversationMessageAttachments` (`convex/schema.ts:612-641`) already proves the polymorphic-row pattern works for us — `attachmentKind: image | document | audio` lives in one table. The April photo-model ADR also explicitly framed `photos` as the canonical record for storage metadata, with `provider | bucket | objectKey | objectVersion` already video-friendly.

## Decision

We extend `photos` in place with a discriminator and video-only optional fields. The table is conceptually renamed to "media" in prose, but the Convex table name stays `photos` to avoid a destructive rename.

Schema deltas:

```ts
const photos = defineTable({
  // ... existing fields unchanged ...
  mediaKind: v.optional(v.union(v.literal("image"), v.literal("video"))), // default "image"
  // Video-only:
  durationMs: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  posterStorageId: v.optional(v.id("_storage")),
  posterObjectKey: v.optional(v.string()),
  posterBucket: v.optional(v.string()),
  posterProvider: v.optional(v.string()),
})
  .index("by_job_kind", ["cleaningJobId", "mediaKind"]) // new
  // ... existing indexes preserved ...
```

`mediaKind` is `optional` so existing rows read as `undefined`, which the resolver treats as `"image"`. No data migration is required for existing photos.

`conversationMessageAttachments.attachmentKind` gains a `"video"` literal, plus the same duration/width/height/poster fields. Conversation media stays in its own table (it never went through the canonical-photo migration).

`propertyImages` is left alone for now. Property gallery videos are deferred to Phase 5 and will get the same discriminator at that point.

## Consequences

**Positive:**
- Zero migration on existing data — every old row is implicitly `mediaKind: "image"`.
- Read paths (`resolvePhotoAccessUrl`, `convex/lib/photoUrls.ts`) extend by branching on `mediaKind`, not by joining a second table.
- Aggregates (`photoStorageAggregate`) keep working — bytes are bytes.
- The April canonical-photo ADR remains true, just generalised to "canonical media."

**Costs:**
- The table name `photos` is now a misnomer for video rows. We accept this; renaming costs more than it earns.
- Some existing queries with `photos.type ∈ {before, after, incident}` need to handle the case where a video also has a `type`. The discriminator is **orthogonal** to `type` — `type` is the workflow slot (before/after/incident), `mediaKind` is the format.
- Indexing: `by_job_type` still works; we add `by_job_kind` for "show me only the videos on this job" and `by_job_type_kind` if profiling shows we need it.

## Alternatives considered

### Sibling `videos` table

Rejected. Doubles the read paths (every gallery has to fan-out + merge two queries) and breaks the canonical-photo ADR's promise that incidents/jobs hold one logical attachment list. Also fragments `photoStorageAggregate`.

### Rename to `media` and migrate

Rejected for v1. Convex table renames require write-then-cutover migrations across both apps and would block this feature for weeks. We can revisit a rename in a future cleanup phase once `mediaKind` is universal — at that point the migration is mechanical.

### Polymorphic `media` JSON blob inside `photos`

Rejected. Loses type safety and makes indexes useless.

## Out of scope

- Conversation message **audio** rows do not become `media` — they keep `attachmentKind: "audio"`. Audio's playback model is sufficiently different that merging buys nothing.
