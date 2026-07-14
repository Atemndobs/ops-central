import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/**
 * One-off cleanup: strip the stale Hospitable listing payload out of
 * `properties.metadata`.
 *
 * WHY
 * ---
 * Measured 2026-07-14 (`npx convex data properties --format jsonl`): the average
 * property document is ~7,459 bytes, of which **`metadata` alone is ~5,346 bytes
 * (72%)**. That blob is a raw Hospitable listing payload — `description` (~2.3 KB
 * of marketing copy), `listings`, `room_details`, `summary`, `house_rules`,
 * `picture`, `ical_imports`, etc.
 *
 * Nothing in this codebase reads those keys. But Convex has no field projection —
 * `ctx.db.get()` always reads the WHOLE document — so every property read pays for
 * them. `enrichJobs` (cleaningJobs/queries.ts) fetches ~8 property docs per call
 * and is invoked by getById / getMyJobDetail / getJobDetail / getInDateRange /
 * cleaningJobs.getAll; `enrichProperties` (properties/queries.ts) does the same for
 * properties.getAll. All of those are reactive and re-execute tens of thousands of
 * times a month — which is how an 8-property portfolio produced ~9 GB of database
 * reads in July and blew the 6 GB Free-plan cap.
 *
 * The payload is STALE: the current sync no longer writes it —
 * `upsertPropertyFromHospitable` (hospitable/mutations.ts) takes no `metadata`
 * argument, and `syncPropertyDetails` passes only normalized scalar fields. So this
 * prune is a one-time fix; the bloat cannot regrow. Anything dropped here remains
 * re-fetchable from the Hospitable API.
 *
 * SAFETY
 * ------
 * Allowlist, not a blind delete. We keep only the small operational keys that are
 * actually used:
 *   - `overrideHistory`     — read by integrations/mutations.ts (approval audit trail)
 *   - `deactivatedAt`       — written by hospitable/mutations.ts deactivation paths
 *   - `deactivatedReason`   — ditto
 *   - `source`              — provenance marker (e.g. "hospitable_auto_sync")
 * Everything else is dropped. Defaults to `dryRun: true`; the caller must pass
 * `{ dryRun: false }` explicitly to write.
 *
 * Run:
 *   npx convex run properties/pruneMetadata:pruneLegacyPropertyMetadata '{"dryRun":true}'
 *   npx convex run properties/pruneMetadata:pruneLegacyPropertyMetadata '{"dryRun":false}'
 */
const METADATA_KEEP_KEYS = new Set<string>([
  "overrideHistory",
  "deactivatedAt",
  "deactivatedReason",
  "source",
]);

export const pruneLegacyPropertyMetadata = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    dryRun: v.boolean(),
    propertiesScanned: v.number(),
    propertiesChanged: v.number(),
    metadataBytesBefore: v.number(),
    metadataBytesAfter: v.number(),
    droppedKeys: v.array(v.string()),
    keptKeys: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    // Default to a no-write dry run so an accidental invocation is harmless.
    const dryRun = args.dryRun ?? true;

    const properties = await ctx.db.query("properties").collect();

    let metadataBytesBefore = 0;
    let metadataBytesAfter = 0;
    let propertiesChanged = 0;
    const droppedKeys = new Set<string>();
    const keptKeys = new Set<string>();

    for (const property of properties) {
      const metadata = property.metadata;
      if (
        metadata === undefined ||
        metadata === null ||
        typeof metadata !== "object" ||
        Array.isArray(metadata)
      ) {
        continue;
      }

      const entries = Object.entries(metadata as Record<string, unknown>);
      metadataBytesBefore += JSON.stringify(metadata).length;

      const kept: Record<string, unknown> = {};
      for (const [key, value] of entries) {
        if (METADATA_KEEP_KEYS.has(key)) {
          kept[key] = value;
          keptKeys.add(key);
        } else {
          droppedKeys.add(key);
        }
      }

      metadataBytesAfter += JSON.stringify(kept).length;

      if (Object.keys(kept).length !== entries.length) {
        propertiesChanged += 1;
        if (!dryRun) {
          await ctx.db.patch(property._id, { metadata: kept });
        }
      }
    }

    return {
      dryRun,
      propertiesScanned: properties.length,
      propertiesChanged,
      metadataBytesBefore,
      metadataBytesAfter,
      droppedKeys: [...droppedKeys].sort(),
      keptKeys: [...keptKeys].sort(),
    };
  },
});
