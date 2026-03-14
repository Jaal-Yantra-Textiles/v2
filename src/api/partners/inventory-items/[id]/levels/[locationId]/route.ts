import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../../helpers"

export const POST = async (
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

  const { id, locationId } = req.params
  const body = req.body as Record<string, any>
  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any
  const updated = await inventoryService.updateInventoryLevels(
    { inventory_item_id: id, location_id: locationId },
    body
  )

  res.json({ inventory_item: updated })
}

export const DELETE = async (
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

  const { id, locationId } = req.params
  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any
  await inventoryService.deleteInventoryLevels(
    { inventory_item_id: id, location_id: locationId }
  )

  res.json({
    id: `${id}-${locationId}`,
    object: "inventory_level",
    deleted: true,
  })
}
