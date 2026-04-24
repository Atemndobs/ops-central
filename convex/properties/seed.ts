import { mutation } from "../_generated/server";
import { ConvexError, v } from "convex/values";

/**
 * One-off seed: populate sample instructions on a property by name.
 *
 * Run once from the repo root:
 *   npx convex run properties/seed:seedInstructionsByName '{"name":"Dallas-The Scandi"}'
 *
 * Safe to re-run: existing instructions are replaced with the fresh sample set
 * so the demo data always reflects what's here.
 */
export const seedInstructionsByName = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const target = args.name.trim();
    const all = await ctx.db
      .query("properties")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    const property = all.find(
      (p) => p.name.trim().toLowerCase() === target.toLowerCase(),
    );

    if (!property) {
      throw new ConvexError(
        `No active property matches "${target}". Check the exact name from the admin /properties list.`,
      );
    }

    const now = Date.now();
    const instructions = [
      {
        id: `ins_seed_access_${now}`,
        category: "access" as const,
        title: "Front door code",
        body:
          "Use code 5542 on the keypad by the front door. Press the lock button once after entering to confirm. If the door sticks, lift the handle slightly while pushing.",
        sourceLang: "en" as const,
        translations: {
          es: {
            title: "Código de la puerta principal",
            body:
              "Use el código 5542 en el teclado junto a la puerta principal. Presione el botón de bloqueo una vez después de entrar para confirmar. Si la puerta se atasca, levante la manija ligeramente mientras empuja.",
          },
        },
        updatedAt: now,
      },
      {
        id: `ins_seed_trash_${now + 1}`,
        category: "trash" as const,
        title: "Trash pickup",
        body:
          "Trash takeout is every Wednesday morning. Roll both bins (black + blue recycling) to the curb on Tuesday evening after turnover. Return them to the side of the house on Wednesday evening if still on-site.",
        sourceLang: "en" as const,
        translations: {
          es: {
            title: "Recolección de basura",
            body:
              "La recolección de basura es todos los miércoles por la mañana. Lleve ambos contenedores (negro + azul de reciclaje) al borde de la acera el martes por la noche después del cambio. Devuélvalos al costado de la casa el miércoles por la noche si todavía está en el lugar.",
          },
        },
        updatedAt: now + 1,
      },
      {
        id: `ins_seed_lawn_${now + 2}`,
        category: "lawn" as const,
        title: "Lawn mowing",
        body:
          "A landscaper mows every other Friday. If you see fresh cuttings on the porch or driveway, sweep them off before guest check-in so the entrance looks clean.",
        sourceLang: "en" as const,
        translations: {
          es: {
            title: "Corte del césped",
            body:
              "Un jardinero corta el césped cada dos viernes. Si ve restos frescos de césped en el porche o la entrada, bárralos antes del check-in del huésped para que la entrada se vea limpia.",
          },
        },
        updatedAt: now + 2,
      },
      {
        id: `ins_seed_hot_tub_${now + 3}`,
        category: "hot_tub" as const,
        title: "Hot tub",
        body:
          "Wipe the cover clean and secure both straps after every turnover. Check the pH test strip stored on the shelf to the left — if yellow or orange, message ops immediately; don't run the jets.",
        sourceLang: "en" as const,
        translations: {
          es: {
            title: "Jacuzzi",
            body:
              "Limpie la cubierta y asegure ambas correas después de cada cambio. Revise la tira de prueba de pH guardada en el estante a la izquierda — si está amarilla o anaranjada, avise a operaciones de inmediato; no encienda los chorros.",
          },
        },
        updatedAt: now + 3,
      },
    ];

    await ctx.db.patch(property._id, {
      instructions,
      updatedAt: now,
    });

    return {
      propertyId: property._id,
      propertyName: property.name,
      instructionCount: instructions.length,
    };
  },
});
