import { v } from "convex/values";
import { query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { requireRole } from "../lib/auth";

export const getForPhotos = query({
  args: {
    photoIds: v.array(v.id("photos")),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "property_ops", "manager"]);

    const uniquePhotoIds = [...new Set(args.photoIds)];
    const photos = await Promise.all(uniquePhotoIds.map((photoId) => ctx.db.get(photoId)));

    return photos
      .filter((photo): photo is Doc<"photos"> => photo !== null)
      .map((photo) => ({
        photoId: photo._id,
        circles: extractReviewCircles(photo.annotations),
        updatedAt: extractUpdatedAt(photo.annotations),
      }));
  },
});

function extractReviewCircles(
  annotations: unknown,
): Array<{
  x: number;
  y: number;
  r: number;
  color: string;
}> {
  if (!annotations || typeof annotations !== "object" || Array.isArray(annotations)) {
    return [];
  }

  const rawCircles = (annotations as Record<string, unknown>).reviewCircles;
  if (!Array.isArray(rawCircles)) {
    return [];
  }

  return rawCircles
    .filter(
      (item): item is { x: number; y: number; r: number; color: string } =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as { x?: unknown }).x === "number" &&
        typeof (item as { y?: unknown }).y === "number" &&
        typeof (item as { r?: unknown }).r === "number" &&
        typeof (item as { color?: unknown }).color === "string",
    )
    .map((circle) => ({
      x: clampUnit(circle.x),
      y: clampUnit(circle.y),
      r: Math.min(0.6, Math.max(0, circle.r)),
      color: circle.color.trim().slice(0, 32) || "#ef4444",
    }))
    .filter((circle) => circle.r > 0);
}

function extractUpdatedAt(annotations: unknown): number | null {
  if (!annotations || typeof annotations !== "object" || Array.isArray(annotations)) {
    return null;
  }
  const rawUpdatedAt = (annotations as Record<string, unknown>).reviewUpdatedAt;
  if (typeof rawUpdatedAt !== "number" || !Number.isFinite(rawUpdatedAt)) {
    return null;
  }
  return rawUpdatedAt;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
