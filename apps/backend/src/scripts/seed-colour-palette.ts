/**
 * Script: seed (or top up) the shared `Colour` product option.
 *
 * Colour is a vocabulary every partner draws from, so it is ONE non-exclusive
 * option row that products link to — not a per-product option each partner
 * re-invents. Each product picks its own subset through the
 * `product_product_option_value` pivot, so two partners sharing the row still
 * cannot see or use each other's selections.
 *
 * 🔑 The hex is the reason this is shared. With per-product options every
 * product's "Terracotta" is a separate value row needing its own
 * `metadata.hex` — copies free to drift, and a new product starts with none.
 * One shared row means 55 values, 55 hexes, defined once.
 *
 * Idempotent: re-running adds only missing values and repairs missing/blank
 * hexes. It never renames or removes anything.
 *
 * Usage:
 *   npx medusa exec src/scripts/seed-colour-palette.ts
 *   npx medusa exec src/scripts/seed-colour-palette.ts -- --dry-run
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  COLOUR_OPTION_TITLE,
  COLOUR_PALETTE,
} from "../lib/product-options/colour-palette"

export default async function seedColourPalette({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any
  const productService = container.resolve(Modules.PRODUCT) as any
  const dryRun = ((args as any) || []).includes?.("--dry-run")

  const [existing] = await productService.listProductOptions(
    { title: COLOUR_OPTION_TITLE, is_exclusive: false },
    { relations: ["values"] }
  )

  if (!existing) {
    logger.info(
      `[colour-palette] creating shared "${COLOUR_OPTION_TITLE}" with ${COLOUR_PALETTE.length} values`
    )
    if (dryRun) {
      return
    }
    // Values carry their hex from birth here. The create path keeps object
    // values intact; the ADD path further down does not (see below).
    await productService.createProductOptions({
      title: COLOUR_OPTION_TITLE,
      is_exclusive: false,
      values: COLOUR_PALETTE.map((c) => ({
        value: c.value,
        metadata: { hex: c.hex },
      })),
    })
    logger.info(`[colour-palette] created.`)
    return
  }

  const byValue = new Map<string, any>(
    (existing.values ?? []).map((v: any) => [v.value, v])
  )
  const missing = COLOUR_PALETTE.filter((c) => !byValue.has(c.value))
  const wrongHex = COLOUR_PALETTE.filter((c) => {
    const row = byValue.get(c.value)
    return row && row.metadata?.hex !== c.hex
  })

  logger.info(
    `[colour-palette] "${COLOUR_OPTION_TITLE}" exists with ${byValue.size} values — ${missing.length} missing, ${wrongHex.length} needing a hex`
  )

  if (dryRun || (!missing.length && !wrongHex.length)) {
    return
  }

  if (missing.length) {
    // updateProductOptions replaces the value list, so send existing values as
    // ids to keep them (and their variant links) exactly where they are.
    await productService.updateProductOptions(existing.id, {
      values: [
        ...(existing.values ?? []).map((v: any) => ({ id: v.id, value: v.value })),
        ...missing.map((c) => ({ value: c.value, metadata: { hex: c.hex } })),
      ],
    })
  }

  // Re-read: the values just created need their ids before the hex can be set.
  const [refreshed] = await productService.listProductOptions(
    { id: existing.id },
    { relations: ["values"] }
  )
  const refreshedByValue = new Map<string, any>(
    (refreshed?.values ?? []).map((v: any) => [v.value, v])
  )

  const repairs = COLOUR_PALETTE.map((c) => {
    const row = refreshedByValue.get(c.value)
    if (!row || row.metadata?.hex === c.hex) {
      return null
    }
    return { id: row.id, metadata: { ...(row.metadata ?? {}), hex: c.hex } }
  }).filter(Boolean) as any[]

  // `updateProductOptionValues` takes (idOrSelector, data) — one call per row.
  for (const repair of repairs) {
    await productService.updateProductOptionValues(repair.id, {
      metadata: repair.metadata,
    })
  }

  logger.info(
    `[colour-palette] added ${missing.length}, set hex on ${repairs.length}.`
  )
}
