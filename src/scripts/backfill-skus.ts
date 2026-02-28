/**
 * Backfill SKUs for existing raw material inventory items.
 *
 * Usage:
 *   npx medusa exec src/scripts/backfill-skus.ts
 *
 * This script:
 * 1. Finds all inventory items linked to raw materials that have no SKU
 * 2. Generates a descriptive SKU for each based on material category, name, and color
 * 3. Updates the inventory item's SKU field
 *
 * Safe to run multiple times — items with existing SKUs are skipped.
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { RAW_MATERIAL_MODULE } from "../modules/raw_material"
import RawMaterialService from "../modules/raw_material/service"
import { buildSkuPrefix, formatSku, nextSequenceNumber } from "../utils/generate-sku"
import RawMaterialInventoryLink from "../links/raw-material-data-inventory"

export default async function backfillSkus({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const inventoryService = container.resolve(Modules.INVENTORY)
  const rawMaterialService: RawMaterialService = container.resolve(RAW_MATERIAL_MODULE)

  logger.info("[backfill-skus] Starting SKU backfill for raw material inventory items...")

  // Fetch all inventory-item ↔ raw-material links
  const { data: links } = await query.graph({
    entity: RawMaterialInventoryLink.entryPoint,
    fields: [
      "inventory_item.id",
      "inventory_item.sku",
      "inventory_item.title",
      "raw_materials.id",
      "raw_materials.name",
      "raw_materials.color",
      "raw_materials.material_type.*",
    ],
  })

  if (!links?.length) {
    logger.info("[backfill-skus] No raw material links found. Nothing to do.")
    return
  }

  logger.info(`[backfill-skus] Found ${links.length} raw material link(s).`)

  let skipped = 0
  let updated = 0
  let errors = 0

  for (const link of links) {
    const inventoryItem = (link as any).inventory_item
    const rawMaterial = (link as any).raw_materials

    if (!inventoryItem || !rawMaterial) {
      logger.warn(`[backfill-skus] Skipping link with missing data: ${JSON.stringify(link)}`)
      skipped++
      continue
    }

    if (inventoryItem.sku) {
      logger.info(`[backfill-skus] Skipping ${inventoryItem.id} — already has SKU: ${inventoryItem.sku}`)
      skipped++
      continue
    }

    try {
      // Get material type for category
      let category = "Other"
      if (rawMaterial.material_type?.category) {
        category = rawMaterial.material_type.category
      } else if (rawMaterial.material_type_id) {
        const mt = await rawMaterialService.retrieveMaterialType(rawMaterial.material_type_id)
        category = mt?.category || "Other"
      }

      const prefix = buildSkuPrefix(category, rawMaterial.name, rawMaterial.color || null)

      // Find existing SKUs with this prefix
      const { data: existingItems } = await query.graph({
        entity: "inventory_item",
        fields: ["sku"],
        filters: {
          sku: { $like: `${prefix}-%` },
        },
      })

      const existingSkus = existingItems
        .map((item: any) => item.sku)
        .filter(Boolean) as string[]

      const seq = nextSequenceNumber(existingSkus, prefix)
      const sku = formatSku(prefix, seq)

      await inventoryService.updateInventoryItems({ id: inventoryItem.id, sku })

      logger.info(`[backfill-skus] ${inventoryItem.id} → ${sku} (${rawMaterial.name})`)
      updated++
    } catch (err) {
      logger.error(`[backfill-skus] Failed to generate SKU for ${inventoryItem.id}: ${err}`)
      errors++
    }
  }

  logger.info(
    `[backfill-skus] Done. Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`
  )
}
