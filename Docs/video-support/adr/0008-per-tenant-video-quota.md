# ADR 0008: Per-tenant video quota (minutes per property per month)

## Status

Proposed — 2026-04-26 (resolves open question #3 from [README](../README.md))

## Context

Video is materially more expensive than photos along every dimension: device CPU and battery to capture and transcode, mobile data to upload, B2 storage for the lifetime of the clip, and B2 egress on every playback. A single 60-second clip is roughly equivalent to ~250 typical job photos in storage, and several thousand photos in egress if it's viewed often.

Existing usage tracking lives in [docs/usage-tracking/](../../usage-tracking/) and [docs/service-usage-monitoring/](../../service-usage-monitoring/). Photos are unmetered today because the per-photo cost is too small to bother with. Video is not in that regime.

We previously deferred quota in [ADR-0006](0006-annotation-and-feature-scope.md). On 2026-04-26 we reversed: quota lands **before** the SaaS rollout (Phase 6).

## Decision

### Quota dimension

Quota is measured in **video-seconds per property per calendar month**, not bytes and not count.

Rationale:
- Bytes are sensitive to compression quality and resolution choices we control on the cleaner's behalf — not a fair user-facing unit.
- Count is gameable (one 60 s clip = sixty 1 s clips).
- Seconds are intuitive ("you have 12 minutes of video left this month for 123 Main St").
- Cost correlates well with seconds at our fixed bitrate target (see [ADR-0003](0003-format-codec-and-size-limits.md)).

### Default tiers

These are starting defaults; any tenant can be overridden in `platformConfig`. Tier mapping to existing SaaS plans is a separate billing decision.

| Tier | Video-seconds/property/month | Equivalent | Use case |
|---|---|---|---|
| Free / trial | 0 | photos only | Default for tenants who haven't opted into video |
| Starter | 600 (10 min) | ~10 × 60 s clips | Light evidence use |
| Standard | 1,800 (30 min) | ~30 × 60 s clips | Default for paying tenants |
| Pro | 6,000 (100 min) | ~100 × 60 s clips | High-touch / corporate housing |
| Custom | configurable | — | Enterprise |

### Counted events

Quota is **consumed at upload completion** (`completeExternalUpload` for outbound, `completeInboundTranscode` for inbound — see [ADR-0007](0007-inbound-whatsapp-video-transcode-worker.md)). Failed uploads do not consume. Deletes do **not** refund — it's a "video-seconds recorded this month" budget, not a storage cap.

The seconds counted are the **stored** duration (post-transcode, post-clipping). A user who tries to upload a 90 s clip that gets clipped to 60 s consumes 60 s.

### Enforcement

- **Soft warning at 80 %** of monthly quota: cleaner UI shows a banner "you have 2 minutes of video left at 123 Main St this month"; admin email.
- **Hard block at 100 %**: `getExternalUploadUrl({ mediaKind: "video" })` returns `error: "QUOTA_EXCEEDED"` with a structured payload `{ remainingSeconds: 0, resetsAt: <epoch>, propertyId, tenantId }`. Capture UI disables the video button with explanation.
- **Override**: admin role can manually grant a one-off bonus (`quotaBonusSeconds`) on a property-month to handle exceptions.

### Data model

New table:

```ts
const videoQuotaUsage = defineTable({
  tenantId: v.id("tenants"),
  propertyId: v.id("properties"),
  yearMonth: v.string(), // "2026-04"
  secondsUsed: v.number(),
  secondsBonus: v.optional(v.number()), // admin override
  lastUpdatedAt: v.number(),
})
  .index("by_tenant_month", ["tenantId", "yearMonth"])
  .index("by_property_month", ["propertyId", "yearMonth"]);
```

Tier limits live in `platformConfig` per tenant; defaults from the table above.

### Reset

The `yearMonth` key gives natural monthly buckets. No cron needed — new bucket = new row when the first video of a new month is uploaded. Historical buckets retain for accounting (12 months minimum).

### Reporting

- Cleaner-facing: per-property remaining-minutes badge in capture UI.
- Admin-facing: per-tenant "video usage" view in the admin dashboard, breakdown by property, month-over-month trend.
- Owner-facing: nothing (owners don't see quota).

## Consequences

**Positive:**
- Predictable cost per tenant. Worst-case storage and egress are bounded.
- Pricing/packaging conversations have a real unit to anchor on.
- Cleaners get clear feedback before they're blocked.

**Costs:**
- One new table, one new query path on every upload-URL request, one new admin UI.
- Quota mismatches between cleaner expectations and admin policy are a customer-service surface area we don't have today. Mitigated by the soft 80 % warning and admin override.
- Some judgment calls about how to count edge cases (a re-upload after a network failure, a mistakenly-recorded clip the cleaner immediately deletes). v1 rule: **count at completion, never refund**. We accept the small fairness loss in favour of an unambiguous rule.

## Alternatives considered

### Quota in bytes

Rejected. See "Quota dimension" — bytes are not a fair user-facing unit at fixed bitrate.

### Quota in clip count

Rejected. Trivially gameable; shorter clips are cheaper and clip count would discourage them.

### Quota per tenant (not per property)

Considered. Per-property is more aligned with how billing maps to inventory — most plans are per-property. Per-tenant pooling is on the table for enterprise customers via the `Custom` tier.

### No quota — meter-and-bill instead

Rejected for v1. Pure metered billing requires invoicing infrastructure we don't have. Quota with tiers reuses our existing plan billing.

### Refund on delete

Rejected. Encourages "upload, view, delete to recover quota" behaviour and complicates accounting. The bytes are already billed against B2 the moment they're uploaded.

## Out of scope

- Carry-over of unused quota to next month.
- Bursting / overage credits at a per-second rate.
- Pooled quota across properties for a tenant.

These are roadmap items if real customer demand emerges; none block v1.
