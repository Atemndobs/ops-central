import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Reconciliation sweep. Event-driven ingestion via the Hospitable webhook
// (src/app/api/webhooks/hospitable/route.ts → convex/hospitable/webhooks.ts)
// is the primary path; this 6-hourly sweep catches any deliveries Hospitable
// dropped or that failed our HMAC check during the discovery window.
// See Docs/2026-05-18-hospitable-webhook-implementation-plan.md.
crons.interval(
  "sync-hospitable-reservations-hourly",
  { hours: 6 },
  internal.hospitable.actions.syncReservations,
  {}
);

crons.interval(
  "sync-hospitable-property-details-daily",
  { hours: 24 },
  internal.hospitable.actions.syncPropertyDetails,
  {}
);

// Daily backstop for guest reviews. Primary path is the review.created
// webhook (convex/hospitable/webhooks.ts); reviews are far lower-volume
// and lower-urgency than reservations, so daily (not hourly) is enough.
// See Docs/superpowers/specs/2026-07-03-review-response-ai-design.md.
crons.interval(
  "sync-hospitable-reviews-daily",
  { hours: 24 },
  internal.hospitable.actions.syncGuestReviews,
  {}
);

crons.interval(
  "expire-report-exports-hourly",
  { hours: 1 },
  internal.reports.mutations.expireExports,
  {},
);

// BACKSTOP ONLY — event-driven escalation via ctx.scheduler.runAt is the
// primary path (see schedulePendingAcknowledgementEscalation in
// cleaningJobs/acknowledgements.ts). This polling sweep stays in place for
// one deploy cycle so in-flight acks seeded before the event-driven path
// shipped still get escalated. Delete after verifying one cycle of logs
// shows zero escalations. Tracking: Docs/2026-04-24-cron-jobs-architecture-and-cost-reduction.md
// 30-min pre-job alert — runs every 5 min, finds jobs starting in the
// 25–35 min window, notifies assigned cleaners + ops once per job via
// upcomingNotifiedAt dedup flag (set on first fire, prevents re-send).
crons.interval(
  "send-upcoming-job-notifications",
  { minutes: 5 },
  internal.cleaningJobs.upcoming.sendUpcomingJobNotifications,
  {},
);

crons.interval(
  "escalate-pending-acknowledgements",
  { minutes: 15 },
  internal.cleaningJobs.acknowledgements.escalateExpiredAcknowledgements,
  {},
);

crons.interval(
  "service-usage-rollup",
  { hours: 1 },
  internal.serviceUsage.crons.rollup,
  {},
);

crons.interval(
  "service-usage-retention",
  { hours: 24 },
  internal.serviceUsage.crons.retention,
  {},
);

// Nightly B2 storage snapshot — sums photo byteSize and records one event
// so the Backblaze card surfaces current GB stored + estimated monthly cost.
crons.cron(
  "service-usage-b2-storage-snapshot-daily",
  "0 1 * * *", // 01:00 UTC daily
  internal.serviceUsage.b2Snapshot.snapshot,
  {},
);

// Nightly Clerk MAU snapshot — queries Clerk admin API for users with
// activity in the trailing 30 days and records one gauge event.
crons.cron(
  "service-usage-clerk-mau-snapshot-daily",
  "30 1 * * *", // 01:30 UTC daily (staggered after B2)
  internal.serviceUsage.clerkSnapshot.snapshot,
  {},
);

// Weekly Convex self-report — row counts per (business-scale) tracked table
// + 24h event volume. Convex doesn't expose a self-billing API from inside a
// function so this is the closest proxy we can get. Runs WEEKLY (was daily):
// each run scans every tracked table, and the row-count metric changes
// slowly, so daily cadence was ~7× the read cost for no added signal. The
// authoritative billing numbers live on the Convex dashboard regardless.
crons.cron(
  "service-usage-convex-snapshot-weekly",
  "0 2 * * 0", // 02:00 UTC every Sunday (staggered after Clerk)
  internal.serviceUsage.convexSnapshot.snapshot,
  {},
);

// Hourly real-quota sync — fetches actual usage numbers from each
// provider's billing API (Convex, Clerk, B2) and upserts them into
// serviceQuotaCounters with source: "provider". Surfaces "you're at
// 90%" alerts on the usage dashboard. See
// docs/service-usage-monitoring/.
crons.interval(
  "service-usage-provider-sync-hourly",
  { hours: 1 },
  internal.serviceUsage.providerSync.fetchAll,
  {},
);

crons.cron(
  "archive-photos-to-minio-every-7-days",
  "0 2 */7 * *",
  internal.files.archiveActions.archiveSevenDayPhotos,
  {
    olderThanDays: 7,
    batchSize: 100,
    dryRun: false,
  },
);

// Daily sweep of orphaned external upload tickets — bucket objects whose
// PUT succeeded but whose `completeExternalUpload` callback never landed.
// Runs at 03:00 UTC, after the B2 storage snapshot (01:00) and Clerk MAU
// snapshot (01:30). See Phase 1 of Docs/video-support/.
crons.cron(
  "sweep-orphaned-media-uploads-daily",
  "0 3 * * *",
  internal.files.orphanCleanup.sweepOrphans,
  {
    graceHours: 24,
    batchSize: 100,
    dryRun: false,
  },
);

// Hourly sweep of pending owner maintenance approvals. For each request whose
// property has `propertyFeeConfig.autoApproveAfterDays` set AND whose age
// exceeds that threshold, books the cost item + flips status to "auto_approved".
// Default-OFF per spec §5 — only fires when ops explicitly enables auto-approval
// on a property. Spec §13a-2.
crons.interval(
  "owner-maintenance-auto-approve-hourly",
  { hours: 1 },
  internal.owner.mutations.sweepAutoApprovals,
  {},
);

// Owner-portal financials backfill — the cron-driven list sync writes new
// stays without totalAmount (Hospitable's list endpoint doesn't return
// `?include=financials`). This nightly enrichment pass calls the detail
// endpoint per stay on a rolling 30-day window so the owner dashboard
// stays accurate going forward. Stays already enriched are skipped
// (`listStaysMissingTotalAmount` filters them out).
crons.cron(
  "owner-hospitable-financials-backfill-daily",
  "30 3 * * *", // 03:30 UTC daily, after orphan sweep
  internal.hospitable.actions.backfillReservationFinancials,
  { lookbackDays: 30, dryRun: false },
);

// Admin Owner Overview — auto-create monthly DRAFT statements on the 1st
// of each month for the previous period. Default OFF behind the
// `owner_overview_auto_drafts` feature flag, mirroring Wave 3b auto-approve.
// See Docs/2026-05-25-admin-owner-overview-plan.md §"Phase 5".
crons.cron(
  "owner-overview-auto-create-monthly-drafts",
  "0 4 1 * *", // 04:00 UTC on the 1st of each month
  internal.admin.ownerOverview.autoCreateMonthlyDrafts,
  {},
);

export default crons;
