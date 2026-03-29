
## Photo Storage Cost Analysis + Recommendation Doc (OpsCentral)

### Summary

- **Recommended primary storage:** Backblaze B2 (S3-compatible) for all job/incident photos, with Convex storing metadata only.
- **Why (your selected profile: lowest cost, `<50 GB` monthly reads, minute-level restore):**
  - 10GB/30GB-read scenario: Convex `~$9.84` (US basis) vs B2 `~$0.00` vs R2 `~$0.00`.
  - 50GB/30GB-read scenario: Convex `~$11.04` (US basis) / `~$14.35` (EU +30%) vs B2 `~$0.20` vs R2 `~$0.60`.
- **Archive strategy:** keep current archive process; add optional “long-term cold” lane only for data older than policy threshold. For minute-level retrieval, do **not** default to deep-cold tiers.

### Key Deliverable

- Create analysis doc at [Photo_Storage_Options_Analysis_2026-03-28.md](/Users/atem/sites/jnabusiness_solutions/apps-ja/opscentral-admin/docs/Photo_Storage_Options_Analysis_2026-03-28.md) with these exact sections:

1. **Executive decision** (B2 hot as default, rationale, when to revisit).
2. **Current-state mapping** (Convex `_storage` usage in `photos`, `incidents.photoIds`, job evidence snapshots).
3. **Pricing table (as of 2026-03-28)** for Convex, B2, R2, S3, Wasabi, Storj.
4. **Scenario math** for 10GB and 50GB storage with 30GB monthly reads (formulas + totals).
5. **Architecture recommendation** for OpsCentral + cleaners app compatibility.
6. **Cold archive options** (Glacier IR/Flexible/Deep) with restore-time tradeoffs.
7. **Risk and migration notes** (no business logic in Next.js; Convex remains source of truth for metadata).
8. **Decision matrix** (cost, restore latency, integration effort, lock-in).
9. **Implementation backlog** (phased tasks and acceptance criteria).

### Interfaces / Implementation Changes To Document

- Keep backward compatibility first (no breaking switch):
  - Keep existing `storageId` path for old photos.
  - Add optional external-object metadata on `photos` records (`provider`, `bucket`, `objectKey`, `objectVersion?`, `archivedTier?`, `archivedAt?`).
- Introduce/plan these Convex-facing APIs:
  - `files.getExternalUploadUrl` (signed upload target for B2/S3 API).
  - `files.completeExternalUpload` (persist metadata in Convex after upload).
  - `files.getPhotoAccessUrl` (single resolver for Convex `_storage` or external object).
- Archive handling:
  - Policy flag per photo/object for `hot` vs `archive`.
  - Restore workflow that can return minute-level URLs for default path; cold-tier restore path documented as optional.

### Test Cases and Scenarios

1. New upload from web stores file externally and metadata in Convex.
2. Existing Convex-stored photos still render (dual-read compatibility).
3. Mobile app photo retrieval unchanged at API contract level.
4. Signed URL access works and expires correctly.
5. Archive-marked photo retrieval path works for both fast and deferred restore modes.
6. Cost model recalculation section in doc reproduces totals from formulas.

### Assumptions and Defaults

- Priority: **lowest monthly cost**.
- Traffic: **under 50GB/month reads**.
- Restore SLA target: **minutes** for normal review workflows.
- Data residency: **no strict restriction**.
- Pricing timestamp: **March 28, 2026**.

### Pricing Sources To Cite In The Doc

- Convex pricing: [convex.dev/pricing](https://www.convex.dev/pricing)
- Cloudflare R2 pricing: [developers.cloudflare.com/r2/pricing](https://developers.cloudflare.com/r2/pricing/)
- Backblaze B2 pricing: [backblaze.com/cloud-storage/transaction-pricing](https://www.backblaze.com/cloud-storage/transaction-pricing)
- Wasabi pricing FAQ: [wasabi.com/pricing/faq](https://wasabi.com/pricing/faq)
- Storj pricing: [storj.io/pricing](https://www.storj.io/pricing)
- AWS S3 pricing: [aws.amazon.com/s3/pricing](https://aws.amazon.com/s3/pricing/)
- AWS S3 regional machine-readable pricing feed (used for rate extraction): [pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json)
- AWS Glacier Deep Archive overview: [aws.amazon.com/s3/storage-classes/glacier/deep-archive](https://aws.amazon.com/s3/storage-classes/glacier/deep-archive/)
