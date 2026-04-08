import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { syncConversationStatusForJob } from "../conversations/lib";

const SIX_HOURS_IN_MS = 6 * 60 * 60 * 1000;

const normalizedReservationValidator = v.object({
  reservationId: v.string(),
  propertyHospitableId: v.string(),
  guestName: v.string(),
  guestEmail: v.optional(v.string()),
  guestPhone: v.optional(v.string()),
  numberOfGuests: v.optional(v.number()),
  checkInAt: v.number(),
  checkOutAt: v.number(),
  lateCheckout: v.boolean(),
  partyRiskFlag: v.boolean(),
  platform: v.optional(v.string()),
  confirmationCode: v.optional(v.string()),
  specialRequests: v.optional(v.string()),
  status: v.optional(v.string()),
  metadata: v.optional(v.any()),
});

function isCancelledStatus(status: string | undefined): boolean {
  if (!status) {
    return false;
  }

  const normalized = status.toLowerCase();
  return normalized === "cancelled" || normalized === "canceled";
}

function buildCleaningNotes(
  partyRiskFlag: boolean,
  lateCheckout: boolean,
  numberOfGuests: number | undefined,
  specialRequests: string | undefined
): string | undefined {
  const notes: string[] = [];

  if (partyRiskFlag) {
    notes.push("Party risk flagged - check for extra cleaning needs.");
  }

  if (lateCheckout) {
    notes.push("Late checkout expected.");
  }

  if (typeof numberOfGuests === "number" && numberOfGuests > 0) {
    notes.push(`${numberOfGuests} guest(s)`);
  }

  if (specialRequests) {
    notes.push(`Special requests: ${specialRequests}`);
  }

  return notes.length > 0 ? notes.join("\n") : undefined;
}

export const upsertReservations = internalMutation({
  args: {
    reservations: v.array(normalizedReservationValidator),
    syncedAt: v.number(),
    syncWindowDays: v.number(),
    sourceErrors: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const summary = {
      reservationsReceived: args.reservations.length,
      staysCreated: 0,
      staysUpdated: 0,
      jobsCreated: 0,
      jobsUpdated: 0,
      jobsCancelled: 0,
      skippedMissingProperty: 0,
      sourceErrors: args.sourceErrors?.length ?? 0,
    };

    const errors: string[] = [...(args.sourceErrors ?? [])];

    for (const reservation of args.reservations) {
      const property = await ctx.db
        .query("properties")
        .withIndex("by_hospitable", (q) =>
          q.eq("hospitableId", reservation.propertyHospitableId)
        )
        .first();

      if (!property) {
        summary.skippedMissingProperty += 1;
        errors.push(
          `Missing property mapping for hospitable property ${reservation.propertyHospitableId} (reservation ${reservation.reservationId}).`
        );
        continue;
      }

      const existingStay = await ctx.db
        .query("stays")
        .withIndex("by_hospitable", (q) =>
          q.eq("hospitableId", reservation.reservationId)
        )
        .first();

      const stayMetadata = {
        source: "hospitable",
        specialRequests: reservation.specialRequests,
        ...(reservation.metadata ?? {}),
      };

      let stayId = existingStay?._id;

      if (existingStay) {
        await ctx.db.patch(existingStay._id, {
          propertyId: property._id,
          guestName: reservation.guestName,
          guestEmail: reservation.guestEmail,
          guestPhone: reservation.guestPhone,
          numberOfGuests: reservation.numberOfGuests,
          checkInAt: reservation.checkInAt,
          checkOutAt: reservation.checkOutAt,
          lateCheckout: reservation.lateCheckout,
          partyRiskFlag: reservation.partyRiskFlag,
          platform: reservation.platform,
          confirmationCode: reservation.confirmationCode,
          metadata: stayMetadata,
          updatedAt: args.syncedAt,
        });
        summary.staysUpdated += 1;
      } else {
        stayId = await ctx.db.insert("stays", {
          propertyId: property._id,
          hospitableId: reservation.reservationId,
          guestName: reservation.guestName,
          guestEmail: reservation.guestEmail,
          guestPhone: reservation.guestPhone,
          numberOfGuests: reservation.numberOfGuests,
          checkInAt: reservation.checkInAt,
          checkOutAt: reservation.checkOutAt,
          lateCheckout: reservation.lateCheckout,
          earlyCheckin: false,
          partyRiskFlag: reservation.partyRiskFlag,
          platform: reservation.platform,
          confirmationCode: reservation.confirmationCode,
          metadata: stayMetadata,
          createdAt: args.syncedAt,
          updatedAt: args.syncedAt,
        });
        summary.staysCreated += 1;
      }

      if (!stayId) {
        errors.push(`Failed to resolve stay for reservation ${reservation.reservationId}.`);
        continue;
      }

      const nextStay = await ctx.db
        .query("stays")
        .withIndex("by_property", (q) => q.eq("propertyId", property._id))
        .filter((q) => q.gt(q.field("checkInAt"), reservation.checkOutAt))
        .order("asc")
        .take(1);

      const scheduledStartAt = reservation.checkOutAt;
      const fallbackEndAt = scheduledStartAt + SIX_HOURS_IN_MS;
      const candidateEndAt = nextStay[0]?.checkInAt ?? fallbackEndAt;
      const scheduledEndAt =
        candidateEndAt > scheduledStartAt ? candidateEndAt : fallbackEndAt;

      const existingJob = await ctx.db
        .query("cleaningJobs")
        .withIndex("by_stay", (q) => q.eq("stayId", stayId))
        .first();

      const reservationCancelled = isCancelledStatus(reservation.status);
      const notesForCleaner = buildCleaningNotes(
        reservation.partyRiskFlag,
        reservation.lateCheckout,
        reservation.numberOfGuests,
        reservation.specialRequests
      );

      if (existingJob) {
        if (
          reservationCancelled &&
          existingJob.status !== "completed" &&
          existingJob.status !== "cancelled"
        ) {
          await ctx.db.patch(existingJob._id, {
            status: "cancelled",
            updatedAt: args.syncedAt,
            metadata: {
              ...(existingJob.metadata ?? {}),
              source: "hospitable",
              reservationStatus: reservation.status,
            },
          });
          await syncConversationStatusForJob(ctx, {
            jobId: existingJob._id,
            nextStatus: "cancelled",
          });
          summary.jobsCancelled += 1;
          continue;
        }

        if (
          existingJob.status === "scheduled" ||
          existingJob.status === "assigned"
        ) {
          await ctx.db.patch(existingJob._id, {
            scheduledStartAt,
            scheduledEndAt,
            partyRiskFlag: reservation.partyRiskFlag,
            notesForCleaner,
            updatedAt: args.syncedAt,
            metadata: {
              ...(existingJob.metadata ?? {}),
              source: "hospitable",
              reservationStatus: reservation.status,
            },
          });
          summary.jobsUpdated += 1;
        }

        continue;
      }

      if (reservationCancelled) {
        continue;
      }

      await ctx.db.insert("cleaningJobs", {
        propertyId: property._id,
        stayId,
        assignedCleanerIds: [],
        status: "scheduled",
        scheduledStartAt,
        scheduledEndAt,
        partyRiskFlag: reservation.partyRiskFlag,
        opsRiskFlag: false,
        isUrgent: false,
        notesForCleaner,
        metadata: {
          source: "hospitable",
          reservationStatus: reservation.status,
        },
        createdAt: args.syncedAt,
        updatedAt: args.syncedAt,
      });

      summary.jobsCreated += 1;
    }

    const syncStatus =
      errors.length > 0 ? (summary.reservationsReceived > 0 ? "partial" : "failed") : "success";

    const existingConfig = (await ctx.db.query("hospitableConfig").collect())[0];

    if (existingConfig) {
      await ctx.db.patch(existingConfig._id, {
        lastSyncAt: args.syncedAt,
        lastSyncStatus: syncStatus,
        syncWindowDays: args.syncWindowDays,
        updatedAt: args.syncedAt,
      });
    } else {
      await ctx.db.insert("hospitableConfig", {
        isActive: true,
        syncWindowDays: args.syncWindowDays,
        lastSyncAt: args.syncedAt,
        lastSyncStatus: syncStatus,
        createdAt: args.syncedAt,
        updatedAt: args.syncedAt,
      });
    }

    return {
      success: syncStatus !== "failed",
      syncStatus,
      summary,
      errors,
    };
  },
});

export const markSyncFailed = internalMutation({
  args: {
    error: v.string(),
    syncedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existingConfig = (await ctx.db.query("hospitableConfig").collect())[0];

    if (existingConfig) {
      await ctx.db.patch(existingConfig._id, {
        lastSyncAt: args.syncedAt,
        lastSyncStatus: `failed: ${args.error}`,
        updatedAt: args.syncedAt,
      });
      return existingConfig._id;
    }

    return await ctx.db.insert("hospitableConfig", {
      isActive: true,
      lastSyncAt: args.syncedAt,
      lastSyncStatus: `failed: ${args.error}`,
      createdAt: args.syncedAt,
      updatedAt: args.syncedAt,
    });
  },
});
