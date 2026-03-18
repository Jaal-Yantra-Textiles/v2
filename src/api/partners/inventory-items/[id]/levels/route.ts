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

  res.json({
    inventory_levels: levels || [],
    count,
    offset: 0,
    limit: 100,
  })
}
