import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { deleteInventoryItemWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext, getPartnerStore } from "../../helpers"

/**
 * Verify the inventory item belongs to the partner's location
 */
async function verifyPartnerInventoryAccess(
  req: AuthenticatedMedusaRequest,
  itemId: string
): Promise<{ item: any; locationId: string }> {
  const { store } = await getPartnerStore(req.auth_context, req.scope)
  const locationId = store.default_location_id

  if (!locationId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No stock location configured for this store"
    )
  }

  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any

  let item: any
  try {
    item = await inventoryService.retrieveInventoryItem(itemId)
  } catch {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory item not found")
  }

  // Verify item has a level at partner's location
  const [levels] = await inventoryService.listAndCountInventoryLevels(
    { inventory_item_id: itemId, location_id: locationId },
    { take: 10 }
  )

  if (!levels.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Inventory item not found in your store"
    )
  }

  // Enrich levels with stock location names
  if (levels.length) {
    const locationIds = [...new Set(levels.map((l: any) => l.location_id).filter(Boolean))]
    if (locationIds.length) {
      const stockLocationService = req.scope.resolve(Modules.STOCK_LOCATION) as any
      const stockLocations = await stockLocationService.listStockLocations(
        { id: locationIds },
        { select: ["id", "name"] }
      )
      const locationMap = new Map(stockLocations.map((sl: any) => [sl.id, sl]))

      for (const level of levels) {
        const sl = locationMap.get(level.location_id)
        level.stock_locations = sl ? [sl] : []
      }
    }
  }

  item.location_levels = levels

  return { item, locationId }
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated")
  }

  const { item } = await verifyPartnerInventoryAccess(req, req.params.id)
  res.json({ inventory_item: item })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated")
  }

  await verifyPartnerInventoryAccess(req, req.params.id)

  const body = req.body as Record<string, any>
  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any
  const updated = await inventoryService.updateInventoryItems(req.params.id, body)

  res.json({ inventory_item: updated })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated")
  }

  await verifyPartnerInventoryAccess(req, req.params.id)

  await deleteInventoryItemWorkflow(req.scope).run({ input: [req.params.id] })
  res.json({ id: req.params.id, object: "inventory_item", deleted: true })
}
