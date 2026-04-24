import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "sync-hospitable-reservations-hourly",
  { hours: 1 },
  internal.hospitable.actions.syncReservations,
  {}
);

crons.interval(
  "sync-hospitable-property-details-daily",
  { hours: 24 },
  internal.hospitable.actions.syncPropertyDetails,
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

export default crons;
