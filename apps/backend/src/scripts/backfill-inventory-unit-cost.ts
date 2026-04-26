/**
 * Script: Backfill unit_cost on raw materials from inventory order line history.
 *
 * For each inventory item linked to a raw material:
 * 1. Finds all order lines linked to that inventory item
 * 2. Picks the most recent non-cancelled order line's price
 * 3. Sets it as the raw_material's unit_cost
 *
 * Items with no raw material link or no order history are listed for manual input.
 *
 * Usage:
 *   npx medusa exec src/scripts/backfill-inventory-unit-cost.ts
 *   npx medusa exec src/scripts/backfill-inventory-unit-cost.ts -- --force
 *   npx medusa exec src/scripts/backfill-inventory-unit-cost.ts -- --dry-run
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function backfillInventoryUnitCost({ container, args }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const inventoryService = container.resolve(Modules.INVENTORY) as any
  const rawMaterialService = container.resolve("raw_materials") as any

  const a = args as any || {}
  const force = a.force !== undefined
  const dryRun = a["dry-run"] !== undefined

  // Get all inventory items
  const items = await inventoryService.listInventoryItems({}, { take: 1000 })
  console.log(`Found ${items.length} inventory items`)

  let updated = 0
  let skipped = 0
  const noHistory: string[] = []
  const noRawMaterial: string[] = []

  for (const item of items) {
    // Find linked raw material
    let rawMaterial: any = null
    try {
      const { data: rmLinks } = await query.graph({
        entity: "inventory_item_raw_materials",
        filters: { inventory_item_id: item.id },
        fields: ["raw_materials.*"],
      })
      rawMaterial = rmLinks?.[0]?.raw_materials
    } catch {
      // Link table might not exist or no link
    }

    if (!rawMaterial) {
      noRawMaterial.push(`  ${item.title || item.sku || item.id} (${item.id})`)
      continue
    }

    const hasExistingCost = rawMaterial.unit_cost != null && Number(rawMaterial.unit_cost) > 0
    if (hasExistingCost && !force) {
      skipped++
      continue
    }

    // Find order lines linked to this inventory item
    let latestPrice: number | null = null
    let latestDate: Date | null = null
    let latestOrderId: string | null = null

    try {
      const { data: orderLineLinks } = await query.graph({
        entity: "inventory_order_line_inventory_item",
        filters: { inventory_item_id: item.id },
        fields: [
          "inventory_order_line.id",
          "inventory_order_line.price",
          "inventory_order_line.inventory_orders.order_date",
          "inventory_order_line.inventory_orders.status",
          "inventory_order_line.inventory_orders.id",
        ],
      })

      for (const link of orderLineLinks || []) {
        const orderLine = (link as any).inventory_order_line
        if (!orderLine) continue
        const order = orderLine.inventory_orders
        if (!order || order.status === "Cancelled") continue

        const orderDate = order.order_date ? new Date(order.order_date) : new Date(0)
        const price = Number(orderLine.price) || 0

        if (price > 0 && (!latestDate || orderDate > latestDate)) {
          latestDate = orderDate
          latestPrice = price
          latestOrderId = order.id
        }
      }
    } catch (e: any) {
      console.warn(`  [${item.id}] Failed to query order lines: ${e.message}`)
    }

    if (latestPrice && latestPrice > 0) {
      console.log(
        `  ${rawMaterial.name || item.title}: ${hasExistingCost ? `${rawMaterial.unit_cost} →` : ""} ${latestPrice} (from order ${latestOrderId}, date: ${latestDate?.toISOString().split("T")[0]})`
      )

      if (!dryRun) {
        await rawMaterialService.updateRawMaterials({
          id: rawMaterial.id,
          unit_cost: latestPrice,
        })
        updated++
      }
    } else {
      noHistory.push(`  ${rawMaterial.name || item.title} (raw_mat: ${rawMaterial.id})`)
    }
  }

  console.log(`\nResults:`)
  console.log(`  Updated: ${updated}`)
  console.log(`  Skipped (already has cost): ${skipped}`)

  if (noRawMaterial.length) {
    console.log(`\n  No raw material linked (${noRawMaterial.length}):`)
    noRawMaterial.forEach((line) => console.log(line))
  }

  if (noHistory.length) {
    console.log(`\n  No order history — needs manual unit_cost (${noHistory.length}):`)
    noHistory.forEach((line) => console.log(line))
  }

  if (dryRun) {
    console.log(`\n  [DRY RUN] No changes written. Remove --dry-run to apply.`)
  }
}
