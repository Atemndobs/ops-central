import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "sync-hospitable-reservations-hourly",
  { hours: 1 },
  internal.hospitable.actions.syncReservations,
  {}
);

export default crons;
