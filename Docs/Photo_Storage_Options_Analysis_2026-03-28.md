# Photo Storage Options Analysis (2026-03-28)

## 1. Executive Decision

### Decision
- Use **Backblaze B2 (S3-compatible)** as the primary storage for new job and incident photos.
- Keep **Convex as metadata/source-of-truth** for photo records, job evidence, and authorization checks.
- Keep existing Convex `_storage` photos readable (dual-read compatibility) during migration.

### Why this is the most cost-effective fit right now
- Selected priorities and assumptions:
  - Lowest monthly cost
  - Under 50 GB/month reads
  - Minute-level operational retrieval for normal review workflows
  - No strict residency constraint
- At your current scale assumptions, B2 and R2 are dramatically cheaper than continuing photo bandwidth through Convex.
- For this specific profile, B2 is the cheapest sustained option among the shortlisted operational stores.

### When to revisit this decision
- If monthly photo read/egress grows above ~3x average stored data (B2 free-egress policy threshold), re-evaluate B2 vs R2.
- If a strict EU-only data residency requirement is introduced, re-run provider/region fit.
- If retrieval SLA changes to hours (instead of minutes), expand deep-cold archive share.

---

## 2. Current-State Mapping

### Where photos are stored today
- `photos` table stores `storageId: v.id("_storage")` as required field.
- `incidents.photoIds` stores photo references as `v.array(v.string())` (currently written from storage IDs in incident flow).
- `jobSubmissions.photoSnapshot[]` stores `storageId: v.id("_storage")`.

### Current upload/read paths in code
- Upload URL generation:
  - `convex/files/mutations.ts` -> `generateUploadUrl` uses `ctx.storage.generateUploadUrl()`.
- Photo persistence:
  - `convex/files/mutations.ts` -> `uploadJobPhoto` persists `storageId` into `photos`.
- URL resolution:
  - `convex/files/queries.ts` -> `getFileUrl`/`getPhotoUrl` use `ctx.storage.getUrl(...)`.
  - `convex/cleaningJobs/queries.ts` -> batched `getPhotoUrlMap` also uses `ctx.storage.getUrl(...)`.
- Incident creation:
  - `convex/incidents/mutations.ts` accepts `photoStorageIds` and maps them into `incidents.photoIds`.

### Practical implication
- Job/incident evidence is tightly coupled to Convex file storage and Convex file bandwidth pricing.
- Property photos already use Cloudinary upload route, but job/incident evidence does not.

### Verification checkpoint (2026-03-28)
- `opscentral-admin/convex/crons.ts` currently has no archive rotation cron (only hospitable sync + report export expiry).
- `jna-cleaners-app/convex/crons.ts` also has no archive rotation cron.
- `jna-cleaners-app` currently contains partial B2 external upload/read functions (`files.getExternalUploadUrl`, `files.completeExternalUpload`, `files.getPhotoAccessUrl`) that are not yet mirrored in this admin-owned backend repo.
- Conclusion:
  - No active 7-day archive automation is currently running in production code.
  - Backend implementation must be consolidated to one owner to avoid split-brain drift.

---

## 3. Pricing Table (As of 2026-03-28)

All figures below are list prices from referenced provider pages and used to compute the scenarios in Section 4.

| Provider | Storage price | Read/egress model (relevant at this scale) | Notes |
|---|---:|---:|---|
| Convex (Starter overage) | `$0.03/GB-month` file storage overage | `$0.33/GB` file bandwidth overage | 1 GB included storage + 1 GB/month file bandwidth on free/starter baseline. |
| Backblaze B2 | `$0.005/GB-month` after first 10 GB | Free egress up to `3x` monthly avg storage, then `$0.01/GB` | S3-compatible API, Class B ops very low cost. |
| Cloudflare R2 Standard | `$0.015/GB-month` after first 10 GB free | Internet egress free; operation charges apply | Free tier includes 10 GB + ops quotas (standard class only). |
| AWS S3 Standard | `$0.023/GB-month` (first 50 TB tier) | Internet data transfer pricing applies (first 100 GB/month aggregated free) | Request charges separate. |
| Wasabi Pay-as-you-go | `$6.99/TB-month` (`$0.0068/GB-month`) | Egress/API free policy-based | 1 TB monthly minimum charge and 90-day minimum retention policy. |
| Storj Archive tier | `$6/TB-month` (`$0.006/GB-month`) | `$0.02/GB` egress, with included egress policy per plan docs | $5 minimum monthly usage fee applies. |

---

## 4. Scenario Math (10 GB and 50 GB, with 30 GB monthly reads)

### Formula assumptions
- API request charges are omitted for scenario totals because they are negligible at this volume vs bandwidth/storage deltas.
- Convex EU pass-through noted separately (`+30%`) per Convex pricing page.
- For AWS S3 Standard, a range is shown:
  - Lower bound: storage-only
  - Upper bound: storage plus representative paid internet egress assumption (`$0.09/GB` for first paid transfer tier).

### Scenario A: 10 GB stored, 30 GB/month reads

- Convex (US basis):  
  - Storage overage: `(10 - 1) * 0.03 = 0.27`
  - Bandwidth overage: `(30 - 1) * 0.33 = 9.57`
  - **Total = $9.84/month**
- Convex (EU +30%): `9.84 * 1.3 = 12.79`
  - **Total = $12.79/month**
- Backblaze B2:
  - Storage after free 10 GB: `0`
  - Egress: `30 GB <= 3 * 10 GB`, so `0`
  - **Total = $0.00/month**
- Cloudflare R2:
  - Storage after free 10 GB: `0`
  - Egress: free
  - **Total = $0.00/month**
- AWS S3 Standard:
  - Storage: `10 * 0.023 = 0.23`
  - With representative paid egress assumption: `30 * 0.09 = 2.70`
  - **Total range = $0.23 to $2.93/month**
- Wasabi:
  - 1 TB monthly minimum
  - **Total = $6.99/month**
- Storj Archive:
  - Raw usage less than $5 minimum
  - **Total = $5.00/month**

### Scenario B: 50 GB stored, 30 GB/month reads

- Convex (US basis):
  - Storage overage: `(50 - 1) * 0.03 = 1.47`
  - Bandwidth overage: `(30 - 1) * 0.33 = 9.57`
  - **Total = $11.04/month**
- Convex (EU +30%): `11.04 * 1.3 = 14.35`
  - **Total = $14.35/month**
- Backblaze B2:
  - Storage after free 10 GB: `(50 - 10) * 0.005 = 0.20`
  - Egress: `30 GB <= 3 * 50 GB`, so `0`
  - **Total = $0.20/month**
- Cloudflare R2:
  - Storage after free 10 GB: `(50 - 10) * 0.015 = 0.60`
  - Egress: free
  - **Total = $0.60/month**
- AWS S3 Standard:
  - Storage: `50 * 0.023 = 1.15`
  - With representative paid egress assumption: `30 * 0.09 = 2.70`
  - **Total range = $1.15 to $3.85/month**
- Wasabi:
  - 1 TB monthly minimum
  - **Total = $6.99/month**
- Storj Archive:
  - Raw usage less than $5 minimum
  - **Total = $5.00/month**

---

## 5. Architecture Recommendation (OpsCentral + Cleaners App Compatible)

### Recommended target architecture
- Keep Convex as control plane and metadata store.
- Move binary object storage for job/incident photos to B2.
- Keep API contracts app-facing through Convex so both web and mobile clients use one backend contract.

### Locked architecture (validated)
```mermaid
flowchart LR
  subgraph Clients
    A["OpsCentral Admin (Next.js)"]
    C["Cleaners App (Expo)"]
  end

  A --> D["Convex Backend (single shared deployment)"]
  C --> D

  D -->|metadata + auth + photo refs| E["Convex DB"]
  D -->|signed upload/read URL flow| F["Backblaze B2 (Hot Primary)"]
  D -->|7-day archive rotation job (admin-owned)| G["MinIO Backup Storage"]
  G --> H["Local NAS (self-hosted backup target)"]

  A -->|review old evidence| D
  D -->|if archived, restore/copy and return access URL| F

  classDef authority fill:#e8f0ff,stroke:#3b82f6,color:#0f172a;
  class D authority;
```

### Ownership boundary (to prevent split-brain)
- Archive orchestration is owned by the **admin backend (Convex code in this repo)**.
- Cleaners app remains user-facing and must not run independent archive cron/scheduler logic.
- Both clients consume the same Convex API contract; neither client should embed archive business rules.

### Backward-compatible data model changes (no breaking switch)
- Keep existing `storageId` path for legacy photos.
- Extend `photos` records with optional external metadata:
  - `provider?: "convex" | "b2" | "s3" | "r2"`
  - `bucket?: string`
  - `objectKey?: string`
  - `objectVersion?: string`
  - `archivedTier?: "hot" | "archive_ir" | "archive_flexible" | "archive_deep"`
  - `archivedAt?: number`
- Migration approach:
  - Widen first (optional new fields, no removals)
  - Dual-write/dual-read period
  - Narrow only after verification

### Convex-facing API additions to implement
- `files.getExternalUploadUrl`
  - Returns signed upload target for B2 S3-compatible API.
- `files.completeExternalUpload`
  - Finalizes upload metadata in Convex `photos` row.
- `files.getPhotoAccessUrl`
  - Single resolver:
    - If `storageId` exists -> Convex signed URL path.
    - Else if external object metadata exists -> provider signed URL path.

### Access/read behavior
- Job details and evidence queries should call one unified resolver path.
- Mobile app stays compatible by continuing to consume URL fields from existing job/detail APIs.

---

## 6. Cold Archive Options (Glacier IR / Flexible / Deep)

For minute-level normal review workflows, keep operational evidence in hot storage (B2).  
Use cold lanes for older evidence only.

| Tier | Storage cost signal | Typical retrieval behavior | Fit for this app |
|---|---|---|---|
| S3 Glacier Instant Retrieval | `~$0.004/GB-month` | Milliseconds retrieval, but archive retrieval fees apply | Good for nearline archive where frequent “old-case” review still happens. |
| S3 Glacier Flexible Retrieval | `~$0.0036/GB-month` | Expedited 1-5 min, standard 3-5 hrs, bulk 5-12 hrs | Good for cost-optimized archive where some reviews can wait hours. |
| S3 Glacier Deep Archive | `~$0.00099/GB-month` | Standard 12+ hrs (up to ~48 hrs by option), cheapest storage | Not default for your stated SLA; keep as optional compliance/deep-history tier only. |

### Archive policy recommendation
- Primary operational evidence: B2 hot.
- Optional archive policy:
  - Age threshold (for example: 180+ days) -> transition to archive lane.
  - Keep incident-linked or flagged legal-review photos in hotter tier longer.
- Restore behavior:
  - Default path: minute-level return URLs.
  - Cold path: asynchronous restore job with status updates.

---

## 7. Risk and Migration Notes

### Non-negotiable architecture rule
- Keep business logic in Convex, not Next.js route handlers.
- Next.js should remain a thin UI/API surface only.

### Main risks and mitigations
- Credential leakage risk:
  - Use server-side signing only; never expose root keys to clients.
- URL expiry/read failures:
  - Use short-lived signed URLs and re-resolve on demand from Convex.
- Schema coupling risk with cleaners mobile app:
  - Widen-migrate-narrow strategy and dual-read compatibility.
- Split-brain backend drift across repos:
  - Define one Convex code owner repo for deployment authority and mirror changes intentionally (not ad hoc).
  - Add CI guard/checklist so archive cron/functions are only introduced in the admin-owned backend.
- Incident photo reference inconsistency:
  - Current `incidents.photoIds` stores string refs; define canonical semantics during migration (prefer `photos` IDs long-term).
- Archive restore latency confusion:
  - Add explicit photo state (`hot`, `archived_pending_restore`, `restored_temp`) for UI and support workflows.

---

## 8. Decision Matrix

| Option | Cost at 50 GB / 30 GB-read profile | Restore latency for old data | Integration effort | Lock-in / operational risk |
|---|---|---|---|---|
| Keep Convex `_storage` only | High (`~$11.04` US basis) | Fast for current data | Lowest short-term (already live) | High cost pressure as usage grows |
| B2 hot + Convex metadata (Recommended) | Lowest (`~$0.20`) | Fast (minutes via hot storage) | Moderate (new upload + resolver APIs) | Low-medium; S3-compatible reduces migration risk |
| R2 standard + Convex metadata | Low (`~$0.60`) | Fast (hot object storage) | Moderate | Medium; Cloudflare platform coupling |
| S3 Standard only | Low-medium (`~$1.15` to `$3.85`) | Fast | Moderate | Medium; can become egress-heavy depending access pattern |
| Wasabi only | Medium (`$6.99` minimum) | Fast | Low-moderate | Policy/minimum constraints at small footprint |
| Storj Archive only | Medium (`$5` minimum at this scale) | Archive-focused | Moderate | Plan/egress policy complexity, minimum fee |

---

## 9. Implementation Backlog (Phased, with Acceptance Criteria)

### Phase 0: Design lock and env setup
- Tasks:
  - Confirm B2 bucket naming, lifecycle defaults, and key scope.
  - Confirm MinIO bucket + NAS target and 7-day archive rotation policy.
  - Lock backend ownership: admin repo owns archive scheduler implementation.
  - Add required env vars and secret management strategy.
- Acceptance criteria:
  - Secrets configured for dev/staging/prod.
  - Signed URL proof-of-concept succeeds from Convex runtime.
  - Architecture diagram and ownership boundary approved by product/ops.

### Phase 1: Schema widen for dual-storage metadata
- Tasks:
  - Add optional external object fields to `photos`.
  - Keep `storageId` backward-compatible.
- Acceptance criteria:
  - Existing Convex-only photos read unchanged.
  - New schema validates and deploys without breaking current apps.

### Phase 2: New Convex file APIs
- Tasks:
  - Implement `files.getExternalUploadUrl`.
  - Implement `files.completeExternalUpload`.
  - Implement `files.getPhotoAccessUrl`.
- Acceptance criteria:
  - New uploads can complete without writing to Convex `_storage`.
  - Access URL resolver returns valid URLs for both legacy and external photos.

### Phase 3: Client integration (web + mobile contract-safe)
- Tasks:
  - Update upload flow to use external signed upload + completion mutation.
  - Keep response contracts stable for existing job detail UI/mobile consumers.
- Acceptance criteria:
  - New upload from web stores object externally and metadata in Convex.
  - Existing Convex photos still render.
  - Mobile app retrieval behavior remains unchanged at API contract level.

### Phase 4: Archive lane and restore workflow
- Tasks:
  - Add object policy flags (`hot` vs archive tier).
  - Implement 7-day archive rotation to MinIO from admin-owned Convex cron.
  - Add restore job/status flow for archived objects.
- Acceptance criteria:
  - Archive-marked photos can be restored and accessed by authorized users.
  - Fast path works for hot photos; deferred path works for deep-cold restores.
  - No archive scheduler exists in cleaners app code path.

### Phase 5: Verification and rollout
- Tasks:
  - Run dual-read production verification and monitoring.
  - Backfill selected legacy objects only if needed.
- Acceptance criteria:
  - Signed URL expiry and re-resolution behavior validated.
  - No regressions in job details, incidents, or submission evidence.
  - Cost model section in this document can be recalculated from formulas and still match expected totals.

---

## Source Links (Pricing and Product References)

- Convex pricing: [https://www.convex.dev/pricing](https://www.convex.dev/pricing)
- Cloudflare R2 pricing: [https://developers.cloudflare.com/r2/pricing/](https://developers.cloudflare.com/r2/pricing/)
- Backblaze B2 transaction/storage pricing notes: [https://www.backblaze.com/cloud-storage/transaction-pricing](https://www.backblaze.com/cloud-storage/transaction-pricing)
- Wasabi pricing FAQ: [https://wasabi.com/pricing/faq](https://wasabi.com/pricing/faq)
- Storj pricing: [https://www.storj.io/pricing](https://www.storj.io/pricing)
- AWS S3 pricing: [https://aws.amazon.com/s3/pricing/](https://aws.amazon.com/s3/pricing/)
- AWS S3 machine-readable pricing feed (us-east-1): [https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json)
- AWS S3 Glacier Deep Archive overview: [https://aws.amazon.com/s3/storage-classes/glacier/deep-archive/](https://aws.amazon.com/s3/storage-classes/glacier/deep-archive/)
