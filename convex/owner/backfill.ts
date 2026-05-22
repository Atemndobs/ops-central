// Wave 2 — cost-data backfill.
//
// Idempotent internal mutation that:
//   1. Assigns canonical `bucket` to each existing `costCategories` row.
//   2. Creates the missing categories (Insurance, Taxes, Management Fee, plus
//      buckets needed to host misfiled prod items: Lawn / Pool / Outdoor,
//      Supplies & Restocks, Labor & Contractors, Other).
//   3. Moves ~13 misfiled `propertyCostItems` to the right category by
//      reading the existing item.name and target bucket.
//
// All bucket writes validate via `isBucket()` from `convex/owner/constants.ts`.
// Defense-in-depth: even if the schema is `v.optional(v.union(...))`, the
// mutation refuses to write a value that isn't in `BUCKETS`.
//
// Dry-run mode returns a structured diff without touching the database. The
// returned audit object is JSON-serializable so it can be inspected via
// `npx convex run` output.
//
// Invocation:
//   CONVEX_DEPLOY_KEY=$PROD_CONVEX_DEPLOY_KEY \
//     npx convex run owner:backfill:migrateCostBuckets '{"dryRun":true}'
//
// Spec: docs/superpowers/specs/2026-05-22-property-owner-portal-design.md §3.4
// Plan: docs/superpowers/plans/2026-05-22-property-owner-portal-plan.md
//       (Task 1.5 of Wave 2 — see docs for future narrowing PR)

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { BUCKETS, isBucket, type Bucket } from "./constants";

// ─── Mapping tables ─────────────────────────────────────────────────────────

/** Canonical bucket for each existing prod category, by exact name. */
const EXISTING_CATEGORY_BUCKETS: Record<string, Bucket> = {
  "Cleaning": "cleaning",
  "Fixed Costs": "lease",       // dominant cost in this category after misfiles
                                // are moved out; admin can rename later
  "Utilities": "utilities",
  "Platform Fees": "platformFees",
  "Maintenance": "maintenance",
  "Subscriptions": "subscriptions",
};

/** Categories to create if not already present (idempotent by exact name). */
const CATEGORIES_TO_ENSURE: Array<{
  name: string;
  bucket: Bucket;
  description: string;
  isFixed: boolean;
  sortOrder: number;
}> = [
  { name: "Lawn / Pool / Outdoor", bucket: "lawnPoolOutdoor",
    description: "Lawn care, pool service, propane, outdoor maintenance",
    isFixed: false, sortOrder: 7 },
  { name: "Supplies & Restocks", bucket: "supplies",
    description: "Consumables and inventory refills (Amazon, in-person)",
    isFixed: false, sortOrder: 8 },
  { name: "Labor & Contractors", bucket: "labor",
    description: "VAs, assistants, hourly contractors",
    isFixed: false, sortOrder: 9 },
  { name: "Insurance", bucket: "insurance",
    description: "Property and liability insurance premiums",
    isFixed: true, sortOrder: 10 },
  { name: "Taxes", bucket: "taxes",
    description: "Property and occupancy taxes",
    isFixed: true, sortOrder: 11 },
  { name: "Management Fee", bucket: "managementFee",
    description: "Accounting-symmetry only; actual fee flows from propertyFeeConfig",
    isFixed: false, sortOrder: 12 },
  { name: "Other", bucket: "other",
    description: "Miscellaneous costs that don't fit other buckets",
    isFixed: false, sortOrder: 13 },
];

/** Per-item moves. Each rule matches a propertyCostItem by (sourceCategoryName, itemName)
 *  or (sourceCategoryName, itemNamePrefix), and points the item at the category whose
 *  bucket equals targetBucket. */
type MoveRule =
  | { sourceCategory: string; matchExact: string; targetBucket: Bucket }
  | { sourceCategory: string; matchPrefix: string; targetBucket: Bucket };

const ITEM_MOVES: MoveRule[] = [
  // Cleaning → Lawn/Pool/Outdoor
  { sourceCategory: "Cleaning", matchExact: "Lawn Mowing", targetBucket: "lawnPoolOutdoor" },
  { sourceCategory: "Cleaning", matchPrefix: "Propane", targetBucket: "lawnPoolOutdoor" },

  // Utilities → Supplies
  { sourceCategory: "Utilities", matchExact: "Amazon Shoping - Refils", targetBucket: "supplies" },

  // Fixed Costs → Labor
  { sourceCategory: "Fixed Costs", matchPrefix: "VA-", targetBucket: "labor" },
  { sourceCategory: "Fixed Costs", matchExact: "Assistant (Clovis)", targetBucket: "labor" },

  // Fixed Costs → Other (marketing/growth — no marketing bucket in v1)
  { sourceCategory: "Fixed Costs", matchExact: "Website-Lumus", targetBucket: "other" },
  { sourceCategory: "Fixed Costs", matchExact: "Growth & Marketing - Lumos", targetBucket: "other" },

  // Fixed Costs → Lawn/Pool/Outdoor (Propane misfile)
  { sourceCategory: "Fixed Costs", matchExact: "Propane Gas (already incl.)", targetBucket: "lawnPoolOutdoor" },

  // Maintenance → Other
  { sourceCategory: "Maintenance", matchExact: "Doordash order", targetBucket: "other" },

  // Subscriptions → Utilities ("trash" is a utility, not a subscription)
  { sourceCategory: "Subscriptions", matchExact: "trash", targetBucket: "utilities" },

  // Subscriptions → Other (market analysis is one-off research, not a recurring SaaS)
  { sourceCategory: "Subscriptions", matchPrefix: "Mkt Analysis", targetBucket: "other" },
];

// ─── Mutation ───────────────────────────────────────────────────────────────

type AuditEntry = {
  action: "create_category" | "update_category_bucket" | "move_item" | "skip_no_change" | "skip_no_match";
  reason: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

export const migrateCostBuckets = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, args) => {
    const audit: AuditEntry[] = [];

    // Defense-in-depth: every bucket we write goes through isBucket().
    const assertBucket = (b: Bucket, context: string): Bucket => {
      if (!isBucket(b)) {
        throw new ConvexError(
          `Refusing to write bucket="${b}" — not in BUCKETS. Context: ${context}. ` +
          `Valid buckets: ${BUCKETS.join(", ")}`,
        );
      }
      return b;
    };

    // ── Pass 1: assign bucket on existing categories ──────────────────────
    const allCategories = await ctx.db.query("costCategories").collect();
    const categoriesByName = new Map<string, typeof allCategories[number]>();
    for (const cat of allCategories) {
      categoriesByName.set(cat.name, cat);
    }

    for (const [name, targetBucket] of Object.entries(EXISTING_CATEGORY_BUCKETS)) {
      const cat = categoriesByName.get(name);
      if (!cat) {
        audit.push({
          action: "skip_no_match",
          reason: `Expected category "${name}" not found in prod — skipping bucket assignment`,
        });
        continue;
      }
      if (cat.bucket === targetBucket) {
        audit.push({
          action: "skip_no_change",
          reason: `Category "${name}" already has bucket="${targetBucket}"`,
        });
        continue;
      }
      assertBucket(targetBucket, `existing category "${name}"`);
      audit.push({
        action: "update_category_bucket",
        reason: `Assigning canonical bucket to existing category "${name}"`,
        before: { _id: cat._id, name: cat.name, bucket: cat.bucket ?? null },
        after: { _id: cat._id, name: cat.name, bucket: targetBucket },
      });
      if (!args.dryRun) {
        await ctx.db.patch(cat._id, { bucket: targetBucket });
      }
    }

    // ── Pass 2: ensure new categories exist (idempotent by name) ──────────
    const ensuredCategoryIdsByBucket = new Map<Bucket, Id<"costCategories">>();
    // For dry-run preview, also track buckets that WOULD have a category by
    // the end of Pass 2 (so Pass 3 can preview item moves even though no real
    // Id exists yet). Real-mode populates `ensuredCategoryIdsByBucket` directly.
    const queuedBucketsForPreview = new Set<Bucket>();
    for (const spec of CATEGORIES_TO_ENSURE) {
      const existing = categoriesByName.get(spec.name);
      if (existing) {
        ensuredCategoryIdsByBucket.set(spec.bucket, existing._id);
        queuedBucketsForPreview.add(spec.bucket);
        if (existing.bucket === spec.bucket) {
          audit.push({
            action: "skip_no_change",
            reason: `Category "${spec.name}" already exists with bucket="${spec.bucket}"`,
          });
        } else {
          assertBucket(spec.bucket, `ensured category "${spec.name}"`);
          audit.push({
            action: "update_category_bucket",
            reason: `Updating bucket on existing category "${spec.name}"`,
            before: { _id: existing._id, name: existing.name, bucket: existing.bucket ?? null },
            after: { _id: existing._id, name: existing.name, bucket: spec.bucket },
          });
          if (!args.dryRun) {
            await ctx.db.patch(existing._id, { bucket: spec.bucket });
          }
        }
        continue;
      }
      assertBucket(spec.bucket, `new category "${spec.name}"`);
      const now = Date.now();
      audit.push({
        action: "create_category",
        reason: `Seeding required bucket category "${spec.name}"`,
        after: {
          name: spec.name,
          bucket: spec.bucket,
          description: spec.description,
          isFixed: spec.isFixed,
          sortOrder: spec.sortOrder,
        },
      });
      if (!args.dryRun) {
        const newId = await ctx.db.insert("costCategories", {
          name: spec.name,
          description: spec.description,
          isFixed: spec.isFixed,
          sortOrder: spec.sortOrder,
          bucket: spec.bucket,
          createdAt: now,
        });
        ensuredCategoryIdsByBucket.set(spec.bucket, newId);
      }
      queuedBucketsForPreview.add(spec.bucket);
    }

    // Existing categories with assigned buckets are also valid move destinations.
    for (const [name, targetBucket] of Object.entries(EXISTING_CATEGORY_BUCKETS)) {
      const cat = categoriesByName.get(name);
      if (cat) {
        ensuredCategoryIdsByBucket.set(targetBucket, cat._id);
        queuedBucketsForPreview.add(targetBucket);
      }
    }

    // ── Pass 3: move misfiled items ───────────────────────────────────────
    const allItems = await ctx.db.query("propertyCostItems").collect();

    // Re-resolve categories-by-name AFTER inserts so item moves can find them
    // even in real-mode. For dry-run we rely on ensuredCategoryIdsByBucket.
    const liveCategoriesByName = new Map<string, typeof allCategories[number]>();
    if (!args.dryRun) {
      const refreshed = await ctx.db.query("costCategories").collect();
      for (const cat of refreshed) liveCategoriesByName.set(cat.name, cat);
    } else {
      for (const cat of allCategories) liveCategoriesByName.set(cat.name, cat);
    }

    for (const rule of ITEM_MOVES) {
      const sourceCat = liveCategoriesByName.get(rule.sourceCategory);
      if (!sourceCat) {
        audit.push({
          action: "skip_no_match",
          reason: `Source category "${rule.sourceCategory}" not found — skipping move rule`,
        });
        continue;
      }
      assertBucket(rule.targetBucket, `move rule for "${rule.sourceCategory}"`);
      const targetCategoryId = ensuredCategoryIdsByBucket.get(rule.targetBucket);
      if (!targetCategoryId && !queuedBucketsForPreview.has(rule.targetBucket)) {
        audit.push({
          action: "skip_no_match",
          reason: `No category and no queued creation for target bucket="${rule.targetBucket}"`,
        });
        continue;
      }

      const matchingItems = allItems.filter((item) => {
        if (item.categoryId !== sourceCat._id) return false;
        if ("matchExact" in rule) return item.name === rule.matchExact;
        return item.name.startsWith(rule.matchPrefix);
      });

      if (matchingItems.length === 0) {
        audit.push({
          action: "skip_no_match",
          reason: `No items matched rule (${rule.sourceCategory} → ${rule.targetBucket}, ${"matchExact" in rule ? `exact="${rule.matchExact}"` : `prefix="${rule.matchPrefix}"`})`,
        });
        continue;
      }

      for (const item of matchingItems) {
        if (targetCategoryId && item.categoryId === targetCategoryId) {
          audit.push({
            action: "skip_no_change",
            reason: `Item "${item.name}" (${item._id}) already in target category`,
          });
          continue;
        }
        audit.push({
          action: "move_item",
          reason: `Moving "${item.name}" from "${rule.sourceCategory}" to bucket="${rule.targetBucket}"`,
          before: { _id: item._id, name: item.name, categoryId: item.categoryId },
          after: { _id: item._id, name: item.name, categoryId: targetCategoryId ?? `(dry-run: new ${rule.targetBucket} category)` },
        });
        if (!args.dryRun) {
          if (!targetCategoryId) {
            throw new ConvexError(`Internal error: targetCategoryId missing for bucket="${rule.targetBucket}" in real mode`);
          }
          await ctx.db.patch(item._id, {
            categoryId: targetCategoryId,
            updatedAt: Date.now(),
          });
        }
      }
    }

    // ── Summary ───────────────────────────────────────────────────────────
    const summary = {
      mode: args.dryRun ? "dry-run" : "applied",
      categoriesCreated: audit.filter((a) => a.action === "create_category").length,
      categoriesBucketUpdated: audit.filter((a) => a.action === "update_category_bucket").length,
      itemsMoved: audit.filter((a) => a.action === "move_item").length,
      skippedNoChange: audit.filter((a) => a.action === "skip_no_change").length,
      skippedNoMatch: audit.filter((a) => a.action === "skip_no_match").length,
    };

    return { summary, audit };
  },
});
