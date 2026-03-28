import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireRole } from "../lib/auth";

const pointValidator = v.object({
  x: v.number(),
  y: v.number(),
});

const reviewCircleValidator = v.object({
  x: v.number(),
  y: v.number(),
  r: v.number(),
  color: v.string(),
});

const reviewShapeValidator = v.union(
  v.object({
    kind: v.literal("circle"),
    x: v.number(),
    y: v.number(),
    r: v.number(),
    color: v.string(),
  }),
  v.object({
    kind: v.literal("freehand"),
    points: v.array(pointValidator),
    color: v.string(),
  }),
  v.object({
    kind: v.literal("line"),
    from: pointValidator,
    to: pointValidator,
    color: v.string(),
  }),
  v.object({
    kind: v.literal("arrow"),
    from: pointValidator,
    to: pointValidator,
    color: v.string(),
  }),
  v.object({
    kind: v.literal("cloud"),
    from: pointValidator,
    to: pointValidator,
    color: v.string(),
  }),
);

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

type LegacyCircle = {
  x: number;
  y: number;
  r: number;
  color: string;
};

export const saveForPhoto = mutation({
  args: {
    photoId: v.id("photos"),
    shapes: v.optional(v.array(reviewShapeValidator)),
    circles: v.optional(v.array(reviewCircleValidator)),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin", "property_ops", "manager"]);
    const photo = await ctx.db.get(args.photoId);
    if (!photo) {
      throw new Error("Photo not found.");
    }

    const normalizedShapesFromArgs = normalizeShapes(args.shapes ?? []);
    const normalizedShapes =
      normalizedShapesFromArgs.length > 0
        ? normalizedShapesFromArgs
        : normalizeShapes((args.circles ?? []).map(toCircleShape));

    const normalizedLegacyCircles = normalizedShapes
      .filter((shape): shape is Extract<ReviewShape, { kind: "circle" }> => shape.kind === "circle")
      .map((circle) => ({
        x: circle.x,
        y: circle.y,
        r: circle.r,
        color: circle.color,
      }));

    const existingAnnotations = asRecord(photo.annotations);
    const updatedAt = Date.now();

    await ctx.db.patch(args.photoId, {
      annotations: {
        ...existingAnnotations,
        reviewShapes: normalizedShapes,
        reviewCircles: normalizedLegacyCircles,
        reviewUpdatedAt: updatedAt,
        reviewUpdatedBy: user._id,
      },
    });

    return {
      ok: true,
      shapeCount: normalizedShapes.length,
      updatedAt,
    };
  },
});

function normalizeShapes(shapes: ReviewShape[]): ReviewShape[] {
  const normalized: ReviewShape[] = [];
  shapes.forEach((shape) => {
    const color = sanitizeColor(shape.color);

    if (shape.kind === "circle") {
      const radius = Math.min(0.6, Math.max(0, safeNumber(shape.r)));
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
      const points = simplifyPoints(shape.points.map(normalizePoint));
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

    const from = normalizePoint(shape.from);
    const to = normalizePoint(shape.to);
    if (distanceBetweenPoints(from, to) < 0.01) {
      return;
    }
    normalized.push({
      kind: shape.kind,
      from,
      to,
      color,
    });
  });
  return normalized;
}

function toCircleShape(circle: LegacyCircle): ReviewShape {
  return {
    kind: "circle",
    x: circle.x,
    y: circle.y,
    r: circle.r,
    color: circle.color,
  };
}

function normalizePoint(point: Point): Point {
  return {
    x: clampUnit(point.x),
    y: clampUnit(point.y),
  };
}

function simplifyPoints(points: Point[]): Point[] {
  const simplified: Point[] = [];
  points.forEach((point) => {
    if (!simplified.length) {
      simplified.push(point);
      return;
    }
    const previous = simplified[simplified.length - 1];
    if (distanceBetweenPoints(previous, point) < 0.002) {
      return;
    }
    simplified.push(point);
  });
  return simplified;
}

function distanceBetweenPoints(left: Point, right: Point): number {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  return Math.sqrt(dx * dx + dy * dy);
}

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

function safeNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value;
}

function sanitizeColor(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "#ef4444";
  }
  return trimmed.slice(0, 32);
}
