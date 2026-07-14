import { v, type Infer } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { syncConversationStatusForJob } from "../conversations/lib";

const SIX_HOURS_IN_MS = 6 * 60 * 60 * 1000;

const normalizedReservationValidator = v.object({
  reservationId: v.string(),
  propertyHospitableId: v.string(),
  guestName: v.string(),
  guestEmail: v.optional(v.string()),
  guestPhone: v.optional(v.string()),
  guestPhotoUrl: v.optional(v.string()),
  numberOfGuests: v.optional(v.number()),
  checkInAt: v.number(),
  checkOutAt: v.number(),
  lateCheckout: v.boolean(),
  partyRiskFlag: v.boolean(),
  platform: v.optional(v.string()),
  confirmationCode: v.optional(v.string()),
  specialRequests: v.optional(v.string()),
  status: v.optional(v.string()),
  // Owner-portal financial fields. Optional because not every reservation
  // payload includes them; the fee engine treats undefined as 0.
  totalAmount: v.optional(v.number()),
  currency: v.optional(v.string()),
  cancelledAt: v.optional(v.number()),
  cancellationSource: v.optional(v.string()),
  metadata: v.optional(v.any()),
});

export type NormalizedReservation = Infer<typeof normalizedReservationValidator>;

export type UpsertSingleReservationDelta = {
  staysCreated: number;
  staysUpdated: number;
  jobsCreated: number;
  jobsUpdated: number;
  jobsCancelled: number;
  skippedMissingProperty: number;
  errors: string[];
};

const EMPTY_DELTA = (): UpsertSingleReservationDelta => ({
  staysCreated: 0,
  staysUpdated: 0,
  jobsCreated: 0,
  jobsUpdated: 0,
  jobsCancelled: 0,
  skippedMissingProperty: 0,
  errors: [],
});

export async function upsertSingleReservation(
  ctx: MutationCtx,
  args: { reservation: NormalizedReservation; syncedAt: number }
): Promise<UpsertSingleReservationDelta> {
  const { reservation, syncedAt } = args;
  const delta = EMPTY_DELTA();

  const property = await ctx.db
    .query("properties")
    .withIndex("by_hospitable", (q) =>
      q.eq("hospitableId", reservation.propertyHospitableId)
    )
    .first();

  if (!property) {
    delta.skippedMissingProperty = 1;
    delta.errors.push(
      `Missing property mapping for hospitable property ${reservation.propertyHospitableId} (reservation ${reservation.reservationId}).`
    );
    return delta;
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
      // Don't downgrade a real stored name back to the "Guest" placeholder if
      // a future sync ever lacks guest detail (e.g. missing include=guest).
      ...(reservation.guestName && reservation.guestName !== "Guest"
        ? { guestName: reservation.guestName }
        : {}),
      guestEmail: reservation.guestEmail,
      guestPhone: reservation.guestPhone,
      numberOfGuests: reservation.numberOfGuests,
      checkInAt: reservation.checkInAt,
      checkOutAt: reservation.checkOutAt,
      lateCheckout: reservation.lateCheckout,
      partyRiskFlag: reservation.partyRiskFlag,
      platform: reservation.platform,
      confirmationCode: reservation.confirmationCode,
      // Don't overwrite a stored photo with undefined on a partial re-sync.
      ...(reservation.guestPhotoUrl !== undefined && {
        guestPhotoUrl: reservation.guestPhotoUrl,
      }),
      // Owner-portal financial fields. Wave 4b: extracted from Hospitable
      // payload by normalizeReservation. Don't overwrite a previously-set
      // value with undefined (avoids data loss on a partial re-sync).
      ...(reservation.totalAmount !== undefined && { totalAmount: reservation.totalAmount }),
      ...(reservation.currency !== undefined && { currency: reservation.currency }),
      ...(reservation.cancelledAt !== undefined && {
        cancelledAt: reservation.cancelledAt,
        cancellationSource: reservation.cancellationSource,
      }),
      metadata: stayMetadata,
      updatedAt: syncedAt,
    });
    delta.staysUpdated = 1;
  } else {
    stayId = await ctx.db.insert("stays", {
      propertyId: property._id,
      hospitableId: reservation.reservationId,
      guestName: reservation.guestName,
      guestEmail: reservation.guestEmail,
      guestPhone: reservation.guestPhone,
      guestPhotoUrl: reservation.guestPhotoUrl,
      numberOfGuests: reservation.numberOfGuests,
      checkInAt: reservation.checkInAt,
      checkOutAt: reservation.checkOutAt,
      lateCheckout: reservation.lateCheckout,
      earlyCheckin: false,
      partyRiskFlag: reservation.partyRiskFlag,
      platform: reservation.platform,
      confirmationCode: reservation.confirmationCode,
      totalAmount: reservation.totalAmount,
      currency: reservation.currency,
      cancelledAt: reservation.cancelledAt,
      cancellationSource: reservation.cancellationSource,
      metadata: stayMetadata,
      createdAt: syncedAt,
      updatedAt: syncedAt,
    });
    delta.staysCreated = 1;
  }

  if (!stayId) {
    delta.errors.push(
      `Failed to resolve stay for reservation ${reservation.reservationId}.`
    );
    return delta;
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
        updatedAt: syncedAt,
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
      delta.jobsCancelled = 1;
      return delta;
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
        updatedAt: syncedAt,
        metadata: {
          ...(existingJob.metadata ?? {}),
          source: "hospitable",
          reservationStatus: reservation.status,
        },
      });
      delta.jobsUpdated = 1;
    }

    return delta;
  }

  if (reservationCancelled) {
    return delta;
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
    createdAt: syncedAt,
    updatedAt: syncedAt,
  });

  delta.jobsCreated = 1;
  return delta;
}

function isCancelledStatus(status: string | undefined): boolean {
  if (!status) {
    return false;
  }

  const normalized = status.toLowerCase();
  return normalized === "cancelled" || normalized === "canceled";
}

function buildCleaningNotes(
  _partyRiskFlag: boolean,
  _lateCheckout: boolean,
  _numberOfGuests: number | undefined,
  specialRequests: string | undefined
): string | undefined {
  // Structured signals (party risk, late checkout, guest count) are surfaced
  // as localized UI on the cleaner views. Only freeform ops text lives here so
  // the stored note doesn't lock us into an English-only rendering.
  if (specialRequests && specialRequests.trim()) {
    return `Special requests: ${specialRequests.trim()}`;
  }

  return undefined;
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
      const delta = await upsertSingleReservation(ctx, {
        reservation,
        syncedAt: args.syncedAt,
      });

      summary.staysCreated += delta.staysCreated;
      summary.staysUpdated += delta.staysUpdated;
      summary.jobsCreated += delta.jobsCreated;
      summary.jobsUpdated += delta.jobsUpdated;
      summary.jobsCancelled += delta.jobsCancelled;
      summary.skippedMissingProperty += delta.skippedMissingProperty;
      errors.push(...delta.errors);
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

export const upsertPropertyFromHospitable = internalMutation({
  args: {
    hospitableId: v.string(),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    country: v.optional(v.string()),
    timezone: v.optional(v.string()),
    currency: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    bedrooms: v.optional(v.number()),
    bathrooms: v.optional(v.number()),
    rooms: v.array(v.object({ name: v.string(), type: v.string() })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("properties")
      .withIndex("by_hospitable", (q) => q.eq("hospitableId", args.hospitableId))
      .first();

    if (existing) {
      const patch: Record<string, unknown> = {
        rooms: args.rooms,
        updatedAt: now,
        // Re-activate if it had been soft-deleted — presence in Hospitable is source of truth.
        isActive: true,
      };
      if (args.bedrooms !== undefined) patch.bedrooms = args.bedrooms;
      if (args.bathrooms !== undefined) patch.bathrooms = args.bathrooms;
      // Only patch address/meta fields when Hospitable supplied a non-empty value, to avoid
      // clobbering admin-edited data with nulls from a sparse Hospitable payload.
      if (args.name) patch.name = args.name;
      if (args.address) patch.address = args.address;
      if (args.city) patch.city = args.city;
      if (args.state) patch.state = args.state;
      if (args.zipCode) patch.zipCode = args.zipCode;
      if (args.country) patch.country = args.country;
      if (args.timezone) patch.timezone = args.timezone;
      if (args.currency) patch.currency = args.currency;
      if (args.imageUrl) patch.imageUrl = args.imageUrl;

      await ctx.db.patch(existing._id, patch);
      return { id: existing._id, action: "updated" as const };
    }

    // Insert — Hospitable has a property we don't know about yet.
    const inserted = await ctx.db.insert("properties", {
      hospitableId: args.hospitableId,
      name: args.name ?? `Hospitable ${args.hospitableId.slice(0, 8)}`,
      address: args.address ?? "Unknown",
      city: args.city,
      state: args.state,
      zipCode: args.zipCode,
      country: args.country,
      timezone: args.timezone,
      currency: args.currency,
      imageUrl: args.imageUrl,
      bedrooms: args.bedrooms,
      bathrooms: args.bathrooms,
      rooms: args.rooms,
      isActive: true,
      metadata: { source: "hospitable_auto_sync" },
      createdAt: now,
      updatedAt: now,
    });
    return { id: inserted, action: "inserted" as const };
  },
});

export const updatePropertyDetails = internalMutation({
  args: {
    hospitableId: v.string(),
    bedrooms: v.optional(v.number()),
    bathrooms: v.optional(v.number()),
    timezone: v.optional(v.string()),
    rooms: v.array(v.object({ name: v.string(), type: v.string() })),
  },
  handler: async (ctx, args) => {
    const property = await ctx.db
      .query("properties")
      .withIndex("by_hospitable", (q) => q.eq("hospitableId", args.hospitableId))
      .first();

    if (!property) {
      throw new Error(`No property found with hospitableId ${args.hospitableId}`);
    }

    const patch: Record<string, unknown> = {
      rooms: args.rooms,
      updatedAt: Date.now(),
    };

    if (args.bedrooms !== undefined) {
      patch.bedrooms = args.bedrooms;
    }
    if (args.bathrooms !== undefined) {
      patch.bathrooms = args.bathrooms;
    }
    if (args.timezone !== undefined) {
      patch.timezone = args.timezone;
    }

    await ctx.db.patch(property._id, patch);
    return property._id;
  },
});

export const softDeletePropertyByHospitableId = internalMutation({
  args: { hospitableId: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const property = await ctx.db
      .query("properties")
      .withIndex("by_hospitable", (q) => q.eq("hospitableId", args.hospitableId))
      .first();
    if (!property) return { action: "noop" as const };
    const now = Date.now();
    await ctx.db.patch(property._id, {
      isActive: false,
      updatedAt: now,
      metadata: {
        ...(property.metadata ?? {}),
        deactivatedAt: now,
        deactivatedReason: args.reason ?? "hospitable_property_deleted",
      },
    });
    return { action: "deactivated" as const, id: property._id };
  },
});

export const deactivateMissingProperties = internalMutation({
  args: {
    hospitableIdsSeen: v.array(v.string()),
    maxDeactivationRatio: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const all = await ctx.db.query("properties").collect();
    const activeTracked = all.filter(
      (p) => p.isActive && typeof p.hospitableId === "string" && p.hospitableId.length > 0,
    );

    const seen = new Set(args.hospitableIdsSeen);
    const toDeactivate = activeTracked.filter(
      (p) => !seen.has(p.hospitableId as string),
    );

    if (activeTracked.length > 0) {
      const ratio = toDeactivate.length / activeTracked.length;
      if (ratio > args.maxDeactivationRatio) {
        return {
          skipped: true,
          reason: `Refused to deactivate ${toDeactivate.length}/${activeTracked.length} (${(ratio * 100).toFixed(0)}%) — exceeds safety cap ${(args.maxDeactivationRatio * 100).toFixed(0)}%`,
          deactivated: 0,
        };
      }
    }

    for (const property of toDeactivate) {
      await ctx.db.patch(property._id, {
        isActive: false,
        updatedAt: now,
        metadata: {
          ...(property.metadata ?? {}),
          deactivatedAt: now,
          deactivatedReason: "not_in_hospitable_listings",
        },
      });
    }

    return { skipped: false, deactivated: toDeactivate.length };
  },
});

export const createPropertyFromHospitable = internalMutation({
  args: {
    hospitableId: v.string(),
    name: v.string(),
    address: v.string(),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    country: v.optional(v.string()),
    timezone: v.optional(v.string()),
    bedrooms: v.optional(v.number()),
    bathrooms: v.optional(v.number()),
    imageUrl: v.optional(v.string()),
    rooms: v.optional(v.array(v.object({ name: v.string(), type: v.string() }))),
  },
  handler: async (ctx, args) => {
    // Idempotent for create. If a row already exists and is missing imageUrl,
    // patch the image in (backfill for older bootstrap that didn't capture it).
    const existing = await ctx.db
      .query("properties")
      .withIndex("by_hospitable", (q) => q.eq("hospitableId", args.hospitableId))
      .first();
    if (existing) {
      if (!existing.imageUrl && args.imageUrl) {
        await ctx.db.patch(existing._id, {
          imageUrl: args.imageUrl,
          updatedAt: Date.now(),
        });
        return { propertyId: existing._id, created: false, imagePatched: true };
      }
      return { propertyId: existing._id, created: false, imagePatched: false };
    }

    const now = Date.now();
    const propertyId = await ctx.db.insert("properties", {
      name: args.name,
      address: args.address,
      city: args.city,
      state: args.state,
      zipCode: args.zipCode,
      country: args.country,
      timezone: args.timezone,
      bedrooms: args.bedrooms,
      bathrooms: args.bathrooms,
      imageUrl: args.imageUrl,
      hospitableId: args.hospitableId,
      rooms: args.rooms,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return { propertyId, created: true, imagePatched: false };
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

/**
 * Internal patch used by `backfillReservationFinancials` — writes only the
 * financial fields (totalAmount, currency, cancelledAt, cancellationSource)
 * onto an existing stay. Never overwrites a set field with undefined so a
 * partial refetch can't clobber prior data.
 */
/**
 * Internal patch used by `backfillReservationPlatforms` — sets the
 * booking platform (e.g. "airbnb", "booking", "homeaway") on an existing
 * stay. No-op if undefined — never clobbers a known platform.
 */
export const patchStayPlatform = internalMutation({
  args: {
    stayId: v.id("stays"),
    platform: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.platform === undefined) return { patched: false };
    await ctx.db.patch(args.stayId, {
      platform: args.platform,
      updatedAt: Date.now(),
    });
    return { patched: true };
  },
});

export const patchStayFinancials = internalMutation({
  args: {
    stayId: v.id("stays"),
    totalAmount: v.optional(v.number()),
    currency: v.optional(v.string()),
    cancelledAt: v.optional(v.number()),
    cancellationSource: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.totalAmount !== undefined) patch.totalAmount = args.totalAmount;
    if (args.currency !== undefined) patch.currency = args.currency;
    if (args.cancelledAt !== undefined) {
      patch.cancelledAt = args.cancelledAt;
      patch.cancellationSource = args.cancellationSource;
    }
    if (Object.keys(patch).length === 1) return { patched: false };
    await ctx.db.patch(args.stayId, patch);
    return { patched: true };
  },
});

/**
 * Idempotent upsert of a single normalized guest review, called from both
 * the `review.created` webhook branch (convex/hospitable/webhooks.ts) and
 * the daily backstop sync (convex/hospitable/actions.ts::syncGuestReviews).
 *
 * Only review FACTS (rating, text, canRespond) are refreshed on repeat
 * delivery — our own workflow `status` (drafted/sent/dismissed/...) is
 * preserved once set, so a re-sync never resets an in-progress or completed
 * reply. On first insert, schedules AI draft generation.
 */
export const upsertGuestReview = internalMutation({
  args: {
    hospitableReviewId: v.string(),
    hospitablePropertyId: v.string(),
    platform: v.union(v.literal("airbnb"), v.literal("direct")),
    rating: v.number(),
    publicReview: v.string(),
    privateFeedback: v.optional(v.string()),
    guestFirstName: v.string(),
    guestLastName: v.string(),
    reviewedAt: v.number(),
    canRespond: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ outcome: "inserted" | "updated" | "skipped_no_property" }> => {
    const property = await ctx.db
      .query("properties")
      .withIndex("by_hospitable", (q) => q.eq("hospitableId", args.hospitablePropertyId))
      .first();

    if (!property) {
      return { outcome: "skipped_no_property" };
    }

    const existing = await ctx.db
      .query("guestReviews")
      .withIndex("by_hospitable_review_id", (q) => q.eq("hospitableReviewId", args.hospitableReviewId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        rating: args.rating,
        publicReview: args.publicReview,
        privateFeedback: args.privateFeedback,
        canRespond: args.canRespond,
      });
      // A row can be stuck in "needs_draft" if a prior generateDraft call
      // failed (e.g. a transient Gemini error) — re-schedule on every
      // re-sync until it succeeds, since the daily backstop is also our
      // only retry mechanism for that failure mode.
      if (existing.status === "needs_draft") {
        await ctx.scheduler.runAfter(0, internal.guestReviews.actions.generateDraft, {
          reviewId: existing._id,
        });
      }
      return { outcome: "updated" };
    }

    const reviewId = await ctx.db.insert("guestReviews", {
      hospitableReviewId: args.hospitableReviewId,
      propertyId: property._id,
      platform: args.platform,
      rating: args.rating,
      publicReview: args.publicReview,
      privateFeedback: args.privateFeedback,
      guestFirstName: args.guestFirstName,
      guestLastName: args.guestLastName,
      reviewedAt: args.reviewedAt,
      canRespond: args.canRespond,
      status: "needs_draft",
    });

    await ctx.scheduler.runAfter(0, internal.guestReviews.actions.generateDraft, { reviewId });

    return { outcome: "inserted" };
  },
});
