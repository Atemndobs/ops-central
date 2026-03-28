import { v } from "convex/values";
import { query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { requireRole } from "../lib/auth";

type Point = {
  x: number;
  y: number;
};

type ReviewShape =
  | {
      kind: "circle";
      x: number;
      y: number;
      r: number;
      color: string;
    }
  | {
      kind: "freehand";
      points: Point[];
      color: string;
    }
  | {
      kind: "line" | "arrow" | "cloud";
      from: Point;
      to: Point;
      color: string;
    };

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
        shapes: extractReviewShapes(photo.annotations),
        updatedAt: extractUpdatedAt(photo.annotations),
      }));
  },
});

function extractReviewShapes(annotations: unknown): ReviewShape[] {
  if (!annotations || typeof annotations !== "object" || Array.isArray(annotations)) {
    return [];
  }

  const record = annotations as Record<string, unknown>;
  const rawShapes = record.reviewShapes;

  if (Array.isArray(rawShapes)) {
    const normalizedShapes = normalizeReviewShapes(rawShapes);
    if (normalizedShapes.length > 0) {
      return normalizedShapes;
    }
  }

  return extractLegacyCircles(record.reviewCircles).map((circle) => ({
    kind: "circle",
    x: circle.x,
    y: circle.y,
    r: circle.r,
    color: circle.color,
  }));
}

function normalizeReviewShapes(rawShapes: unknown[]): ReviewShape[] {
  const normalized: ReviewShape[] = [];
  rawShapes.forEach((rawShape) => {
    if (!rawShape || typeof rawShape !== "object" || Array.isArray(rawShape)) {
      return;
    }
    const shape = rawShape as Record<string, unknown>;
    const color = sanitizeColor(shape.color);
    if (typeof shape.kind !== "string") {
      return;
    }

    if (shape.kind === "circle") {
      if (
        typeof shape.x !== "number" ||
        typeof shape.y !== "number" ||
        typeof shape.r !== "number"
      ) {
        return;
      }
      const radius = Math.min(0.6, Math.max(0, shape.r));
      if (radius <= 0) {
        return;
      }
      normalized.push({
        kind: "circle",
        x: clampUnit(shape.x),
        y: clampUnit(shape.y),
        r: radius,
        color,
      });
      return;
    }

    if (shape.kind === "freehand") {
      if (!Array.isArray(shape.points)) {
        return;
      }
      const points = shape.points
        .flatMap((rawPoint) => {
          if (
            !rawPoint ||
            typeof rawPoint !== "object" ||
            Array.isArray(rawPoint) ||
            typeof (rawPoint as { x?: unknown }).x !== "number" ||
            typeof (rawPoint as { y?: unknown }).y !== "number"
          ) {
            return [];
          }
          return [
            {
              x: clampUnit((rawPoint as { x: number }).x),
              y: clampUnit((rawPoint as { y: number }).y),
            },
          ];
        });
      if (points.length < 2) {
        return;
      }
      normalized.push({
        kind: "freehand",
        points,
        color,
      });
      return;
    }

    if (shape.kind === "line" || shape.kind === "arrow" || shape.kind === "cloud") {
      const from = toPoint(shape.from);
      const to = toPoint(shape.to);
      if (!from || !to) {
        return;
      }
      if (distanceBetweenPoints(from, to) < 0.01) {
        return;
      }
      normalized.push({
        kind: shape.kind,
        from,
        to,
        color,
      });
      return;
    }
  });
  return normalized;
}

function extractLegacyCircles(legacy: unknown): Array<{
  x: number;
  y: number;
  r: number;
  color: string;
}> {
  if (!Array.isArray(legacy)) {
    return [];
  }
  const circles: Array<{ x: number; y: number; r: number; color: string }> = [];
  legacy.forEach((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      typeof (item as { x?: unknown }).x !== "number" ||
      typeof (item as { y?: unknown }).y !== "number" ||
      typeof (item as { r?: unknown }).r !== "number" ||
      typeof (item as { color?: unknown }).color !== "string"
    ) {
      return;
    }
    const radius = Math.min(0.6, Math.max(0, (item as { r: number }).r));
    if (radius <= 0) {
      return;
    }
    circles.push({
      x: clampUnit((item as { x: number }).x),
      y: clampUnit((item as { y: number }).y),
      r: radius,
      color: sanitizeColor((item as { color: string }).color),
    });
  });
  return circles;
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

function toPoint(rawPoint: unknown): Point | null {
  if (
    !rawPoint ||
    typeof rawPoint !== "object" ||
    Array.isArray(rawPoint) ||
    typeof (rawPoint as { x?: unknown }).x !== "number" ||
    typeof (rawPoint as { y?: unknown }).y !== "number"
  ) {
    return null;
  }
  return {
    x: clampUnit((rawPoint as { x: number }).x),
    y: clampUnit((rawPoint as { y: number }).y),
  };
}

function distanceBetweenPoints(left: Point, right: Point): number {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function sanitizeColor(value: unknown): string {
  if (typeof value !== "string") {
    return "#ef4444";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "#ef4444";
  }
  return trimmed.slice(0, 32);
}
