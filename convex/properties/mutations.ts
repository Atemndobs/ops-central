import { mutation, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";

const SUPPORTED_LANGS = ["en", "es"] as const;
type SupportedLang = (typeof SUPPORTED_LANGS)[number];

const TRANSLATE_LANG = v.union(v.literal("en"), v.literal("es"));

/** Auto-translation override shape provided by admin's side-by-side editor. */
const TRANSLATIONS_INPUT = v.optional(
  v.object({
    en: v.optional(v.object({ title: v.string(), body: v.string() })),
    es: v.optional(v.object({ title: v.string(), body: v.string() })),
  }),
);

type TranslationsRecord = Partial<
  Record<SupportedLang, { title: string; body: string }>
>;

/**
 * Drop translations matching the source language (those would shadow the
 * source) and entries with empty title or body. Returns undefined when no
 * usable entries remain so callers can avoid persisting empty objects.
 */
function sanitizeTranslations(
  input: TranslationsRecord | undefined,
  sourceLang: SupportedLang,
): TranslationsRecord | undefined {
  if (!input) return undefined;
  const out: TranslationsRecord = {};
  for (const lang of SUPPORTED_LANGS) {
    if (lang === sourceLang) continue;
    const entry = input[lang];
    if (!entry) continue;
    const title = entry.title.trim();
    const body = entry.body.trim();
    if (!title || !body) continue;
    out[lang] = { title, body };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Merge two translation maps; later overrides earlier. */
function mergeTranslations(
  base: TranslationsRecord | undefined,
  overrides: TranslationsRecord | undefined,
): TranslationsRecord | undefined {
  if (!base && !overrides) return undefined;
  return { ...(base ?? {}), ...(overrides ?? {}) };
}

/**
 * Schedule the translation action for every supported language that
 * differs from the source AND wasn't supplied manually by the admin.
 */
function scheduleMissingTranslations(
  ctx: MutationCtx,
  args: {
    propertyId: Id<"properties">;
    instructionId: string;
    sourceLang: SupportedLang;
    title: string;
    body: string;
    provided: TranslationsRecord | undefined;
  },
): void {
  for (const target of SUPPORTED_LANGS) {
    if (target === args.sourceLang) continue;
    if (args.provided?.[target]) continue;
    void ctx.scheduler.runAfter(
      0,
      internal.translation.actions.translateInstruction,
      {
        propertyId: args.propertyId,
        instructionId: args.instructionId,
        sourceLang: args.sourceLang,
        targetLang: target,
        title: args.title,
        body: args.body,
      },
    );
  }
}

export const create = mutation({
  args: {
    name: v.string(),
    address: v.string(),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    country: v.optional(v.string()),
    timezone: v.optional(v.string()),
    propertyType: v.optional(v.string()),
    bedrooms: v.optional(v.number()),
    bathrooms: v.optional(v.number()),
    squareFeet: v.optional(v.number()),
    hospitableId: v.optional(v.string()),
    airbnbUrl: v.optional(v.string()),
    vrboUrl: v.optional(v.string()),
    directBookingUrl: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    accessNotes: v.optional(v.string()),
    keyLocation: v.optional(v.string()),
    parkingNotes: v.optional(v.string()),
    urgentNotes: v.optional(v.string()),
    currency: v.optional(v.string()),
    amenities: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    try {
      const timestamp = Date.now();
      const name = args.name.trim();
      const address = args.address.trim();

      if (!name || !address) {
        throw new ConvexError("Name and address are required.");
      }

      if (
        args.bedrooms !== undefined &&
        (args.bedrooms < 0 || !Number.isFinite(args.bedrooms))
      ) {
        throw new ConvexError("Bedrooms must be a non-negative number.");
      }

      if (
        args.bathrooms !== undefined &&
        (args.bathrooms < 0 || !Number.isFinite(args.bathrooms))
      ) {
        throw new ConvexError("Bathrooms must be a non-negative number.");
      }

      return await ctx.db.insert("properties", {
        name,
        address,
        city: args.city?.trim(),
        state: args.state?.trim(),
        zipCode: args.zipCode?.trim(),
        country: args.country?.trim(),
        timezone: args.timezone?.trim(),
        propertyType: args.propertyType?.trim(),
        bedrooms: args.bedrooms,
        bathrooms: args.bathrooms,
        squareFeet: args.squareFeet,
        hospitableId: args.hospitableId,
        airbnbUrl: args.airbnbUrl,
        vrboUrl: args.vrboUrl,
        directBookingUrl: args.directBookingUrl,
        imageUrl: args.imageUrl,
        accessNotes: args.accessNotes?.trim() || undefined,
        keyLocation: args.keyLocation?.trim() || undefined,
        parkingNotes: args.parkingNotes?.trim() || undefined,
        urgentNotes: args.urgentNotes?.trim() || undefined,
        currency: args.currency,
        amenities: args.amenities,
        metadata: args.metadata,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } catch (error) {
      if (error instanceof ConvexError) {
        throw error;
      }
      throw new ConvexError("Unable to create property right now.");
    }
  },
});

export const update = mutation({
  args: {
    id: v.id("properties"),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    country: v.optional(v.string()),
    timezone: v.optional(v.string()),
    propertyType: v.optional(v.string()),
    bedrooms: v.optional(v.number()),
    bathrooms: v.optional(v.number()),
    squareFeet: v.optional(v.number()),
    hospitableId: v.optional(v.string()),
    airbnbUrl: v.optional(v.string()),
    vrboUrl: v.optional(v.string()),
    directBookingUrl: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    accessNotes: v.optional(v.string()),
    keyLocation: v.optional(v.string()),
    parkingNotes: v.optional(v.string()),
    urgentNotes: v.optional(v.string()),
    currency: v.optional(v.string()),
    amenities: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
    isActive: v.optional(v.boolean()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const existing = await ctx.db.get(args.id);

      if (!existing || !existing.isActive) {
        throw new ConvexError("Property not found.");
      }

      const { id, ...patch } = args;

      if (patch.name !== undefined && !patch.name.trim()) {
        throw new ConvexError("Name cannot be empty.");
      }

      if (patch.address !== undefined && !patch.address.trim()) {
        throw new ConvexError("Address cannot be empty.");
      }

      if (
        patch.bedrooms !== undefined &&
        (patch.bedrooms < 0 || !Number.isFinite(patch.bedrooms))
      ) {
        throw new ConvexError("Bedrooms must be a non-negative number.");
      }

      if (
        patch.bathrooms !== undefined &&
        (patch.bathrooms < 0 || !Number.isFinite(patch.bathrooms))
      ) {
        throw new ConvexError("Bathrooms must be a non-negative number.");
      }

      await ctx.db.patch(id, {
        ...patch,
        name: patch.name?.trim(),
        address: patch.address?.trim(),
        city: patch.city?.trim(),
        state: patch.state?.trim(),
        zipCode: patch.zipCode?.trim(),
        country: patch.country?.trim(),
        timezone: patch.timezone?.trim(),
        propertyType: patch.propertyType?.trim(),
        accessNotes:
          patch.accessNotes === undefined
            ? undefined
            : patch.accessNotes.trim() || undefined,
        keyLocation:
          patch.keyLocation === undefined
            ? undefined
            : patch.keyLocation.trim() || undefined,
        parkingNotes:
          patch.parkingNotes === undefined
            ? undefined
            : patch.parkingNotes.trim() || undefined,
        urgentNotes:
          patch.urgentNotes === undefined
            ? undefined
            : patch.urgentNotes.trim() || undefined,
        updatedAt: Date.now(),
      });

      return id;
    } catch (error) {
      if (error instanceof ConvexError) {
        throw error;
      }
      throw new ConvexError("Unable to update property right now.");
    }
  },
});

const INSTRUCTION_CATEGORY = v.union(
  v.literal("access"),
  v.literal("trash"),
  v.literal("lawn"),
  v.literal("hot_tub"),
  v.literal("pool"),
  v.literal("parking"),
  v.literal("wifi"),
  v.literal("checkout"),
  v.literal("pets"),
  v.literal("other"),
);

function randomInstructionId(): string {
  return `ins_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/**
 * Update the 4 legacy "before you arrive" fields inline from the admin
 * property-detail panel. Any field omitted is left untouched; passing an
 * empty string clears it.
 */
export const updateAccessFields = mutation({
  args: {
    id: v.id("properties"),
    accessNotes: v.optional(v.string()),
    keyLocation: v.optional(v.string()),
    parkingNotes: v.optional(v.string()),
    urgentNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing || !existing.isActive) {
      throw new ConvexError("Property not found.");
    }

    const clean = (value: string | undefined) =>
      value === undefined ? undefined : value.trim() || undefined;

    await ctx.db.patch(args.id, {
      accessNotes: clean(args.accessNotes),
      keyLocation: clean(args.keyLocation),
      parkingNotes: clean(args.parkingNotes),
      urgentNotes: clean(args.urgentNotes),
      updatedAt: Date.now(),
    });

    return args.id;
  },
});

/** Append a new instruction to a property's extensible instructions list. */
export const addInstruction = mutation({
  args: {
    propertyId: v.id("properties"),
    category: INSTRUCTION_CATEGORY,
    title: v.string(),
    body: v.string(),
    sourceLang: v.optional(TRANSLATE_LANG),
    // If admin filled the side-by-side editor manually, persist their text and
    // skip the auto-translation for those languages.
    translations: TRANSLATIONS_INPUT,
  },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.isActive) {
      throw new ConvexError("Property not found.");
    }

    const title = args.title.trim();
    const body = args.body.trim();
    if (!title) throw new ConvexError("Title is required.");
    if (!body) throw new ConvexError("Body is required.");

    const sourceLang: SupportedLang = args.sourceLang ?? "en";
    const cleanedTranslations = sanitizeTranslations(args.translations, sourceLang);

    const now = Date.now();
    const newId = randomInstructionId();
    const next = [
      ...(property.instructions ?? []),
      {
        id: newId,
        category: args.category,
        title,
        body,
        sourceLang,
        translations: cleanedTranslations,
        updatedAt: now,
      },
    ];

    await ctx.db.patch(args.propertyId, {
      instructions: next,
      updatedAt: now,
    });

    // Auto-translate any language not supplied manually.
    scheduleMissingTranslations(ctx, {
      propertyId: args.propertyId,
      instructionId: newId,
      sourceLang,
      title,
      body,
      provided: cleanedTranslations,
    });

    return newId;
  },
});

/** Edit an existing instruction by id. */
export const updateInstruction = mutation({
  args: {
    propertyId: v.id("properties"),
    instructionId: v.string(),
    category: v.optional(INSTRUCTION_CATEGORY),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    sourceLang: v.optional(TRANSLATE_LANG),
    translations: TRANSLATIONS_INPUT,
  },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.isActive) {
      throw new ConvexError("Property not found.");
    }

    const current = property.instructions ?? [];
    const index = current.findIndex((ins) => ins.id === args.instructionId);
    if (index === -1) {
      throw new ConvexError("Instruction not found.");
    }

    const now = Date.now();
    const trimmedTitle = args.title?.trim();
    const trimmedBody = args.body?.trim();

    if (trimmedTitle !== undefined && !trimmedTitle) {
      throw new ConvexError("Title cannot be empty.");
    }
    if (trimmedBody !== undefined && !trimmedBody) {
      throw new ConvexError("Body cannot be empty.");
    }

    const existing = current[index];
    const sourceLang: SupportedLang =
      args.sourceLang ?? (existing.sourceLang as SupportedLang | undefined) ?? "en";
    const finalTitle = trimmedTitle ?? existing.title;
    const finalBody = trimmedBody ?? existing.body;
    const sourceChanged = trimmedTitle !== undefined || trimmedBody !== undefined;

    // Source edits invalidate stale auto-translations. Admin-supplied
    // translations override that (side-by-side editor).
    const baseTranslations = sourceChanged ? undefined : existing.translations;
    const cleanedManual = sanitizeTranslations(args.translations, sourceLang);
    const mergedTranslations = mergeTranslations(baseTranslations, cleanedManual);

    const next = current.slice();
    next[index] = {
      ...existing,
      category: args.category ?? existing.category,
      title: finalTitle,
      body: finalBody,
      sourceLang,
      translations: mergedTranslations,
      updatedAt: now,
    };

    await ctx.db.patch(args.propertyId, {
      instructions: next,
      updatedAt: now,
    });

    if (sourceChanged) {
      scheduleMissingTranslations(ctx, {
        propertyId: args.propertyId,
        instructionId: args.instructionId,
        sourceLang,
        title: finalTitle,
        body: finalBody,
        provided: cleanedManual,
      });
    }

    return args.instructionId;
  },
});

/** Remove an instruction by id. */
export const removeInstruction = mutation({
  args: {
    propertyId: v.id("properties"),
    instructionId: v.string(),
  },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.isActive) {
      throw new ConvexError("Property not found.");
    }

    const current = property.instructions ?? [];
    const next = current.filter((ins) => ins.id !== args.instructionId);
    if (next.length === current.length) {
      throw new ConvexError("Instruction not found.");
    }

    await ctx.db.patch(args.propertyId, {
      instructions: next,
      updatedAt: Date.now(),
    });

    return args.instructionId;
  },
});

export const softDelete = mutation({
  args: {
    id: v.id("properties"),
  },
  handler: async (ctx, args) => {
    try {
      const existing = await ctx.db.get(args.id);

      if (!existing || !existing.isActive) {
        throw new ConvexError("Property not found.");
      }

      await ctx.db.patch(args.id, {
        isActive: false,
        updatedAt: Date.now(),
      });

      return args.id;
    } catch (error) {
      if (error instanceof ConvexError) {
        throw error;
      }
      throw new ConvexError("Unable to archive property right now.");
    }
  },
});
