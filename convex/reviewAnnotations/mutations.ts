import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireRole } from "../lib/auth";

const reviewCircleValidator = v.object({
  x: v.number(),
  y: v.number(),
  r: v.number(),
  color: v.string(),
});

export const saveForPhoto = mutation({
  args: {
    photoId: v.id("photos"),
    circles: v.array(reviewCircleValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin", "property_ops", "manager"]);
    const photo = await ctx.db.get(args.photoId);
    if (!photo) {
      throw new Error("Photo not found.");
    }

    const normalizedCircles = args.circles
      .map((circle) => ({
        x: clampUnit(circle.x),
        y: clampUnit(circle.y),
        r: Math.min(0.6, Math.max(0, Number.isFinite(circle.r) ? circle.r : 0)),
        color: sanitizeColor(circle.color),
      }))
      .filter((circle) => circle.r > 0);

    const existingAnnotations = asRecord(photo.annotations);
    const updatedAt = Date.now();

    await ctx.db.patch(args.photoId, {
      annotations: {
        ...existingAnnotations,
        reviewCircles: normalizedCircles,
        reviewUpdatedAt: updatedAt,
        reviewUpdatedBy: user._id,
      },
    });

    return {
      ok: true,
      circleCount: normalizedCircles.length,
      updatedAt,
    };
  },
});

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function sanitizeColor(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "#ef4444";
  }
  return trimmed.slice(0, 32);
}
