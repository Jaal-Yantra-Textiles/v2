import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext, getPartnerStore } from "../../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const { store } = await getPartnerStore(req.auth_context, req.scope)
  const locationId = store.default_location_id

  const { id } = req.params
  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any

  // Only return levels at the partner's location
  const filters: any = { inventory_item_id: id }
  if (locationId) {
    filters.location_id = locationId
  }

  const [levels, count] = await inventoryService.listAndCountInventoryLevels(
    filters,
    { take: 100 }
  )

  // Enrich levels with stock location names
  if (levels?.length) {
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

  res.json({
    inventory_levels: levels || [],
    count,
    offset: 0,
    limit: 100,
  })
}
