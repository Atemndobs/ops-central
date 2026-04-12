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
