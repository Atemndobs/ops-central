import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

type PhotoCountable = {
  objectKey?: string;
  byteSize?: number;
};

type AggregateDelta = {
  byteSizeDelta: number;
  countDelta: number;
  sizedCountDelta: number;
};

function classify(photo: PhotoCountable): {
  counts: boolean;
  hasSize: boolean;
} {
  const counts =
    typeof photo.objectKey === "string" && photo.objectKey.length > 0;
  const hasSize =
    counts &&
    typeof photo.byteSize === "number" &&
    Number.isFinite(photo.byteSize) &&
    photo.byteSize > 0;
  return { counts, hasSize };
}

export async function getPhotoStorageAggregate(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"photoStorageAggregate"> | null> {
  return await ctx.db.query("photoStorageAggregate").first();
}

async function applyDelta(
  ctx: MutationCtx,
  delta: AggregateDelta,
): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db.query("photoStorageAggregate").first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      totalBytes: Math.max(0, existing.totalBytes + delta.byteSizeDelta),
      photoCount: Math.max(0, existing.photoCount + delta.countDelta),
      photosWithSize: Math.max(
        0,
        existing.photosWithSize + delta.sizedCountDelta,
      ),
      updatedAt: now,
    });
    return;
  }
  await ctx.db.insert("photoStorageAggregate", {
    totalBytes: Math.max(0, delta.byteSizeDelta),
    photoCount: Math.max(0, delta.countDelta),
    photosWithSize: Math.max(0, delta.sizedCountDelta),
    updatedAt: now,
  });
}

export async function onPhotoInserted(
  ctx: MutationCtx,
  photo: PhotoCountable,
): Promise<void> {
  const { counts, hasSize } = classify(photo);
  if (!counts) return;
  await applyDelta(ctx, {
    byteSizeDelta: hasSize ? (photo.byteSize as number) : 0,
    countDelta: 1,
    sizedCountDelta: hasSize ? 1 : 0,
  });
}

export async function onPhotoDeleted(
  ctx: MutationCtx,
  photo: Doc<"photos">,
): Promise<void> {
  const { counts, hasSize } = classify(photo);
  if (!counts) return;
  await applyDelta(ctx, {
    byteSizeDelta: hasSize ? -(photo.byteSize as number) : 0,
    countDelta: -1,
    sizedCountDelta: hasSize ? -1 : 0,
  });
}
