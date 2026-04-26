import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { deleteInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext, getPartnerStore } from "../../../../helpers"

async function verifyLocationAccess(
  req: AuthenticatedMedusaRequest,
  locationId: string
) {
  const { store } = await getPartnerStore(req.auth_context, req.scope)
  if (store.default_location_id !== locationId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "You can only manage inventory at your own stock location"
    )
  }
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated")
  }

  const { id, locationId } = req.params
  await verifyLocationAccess(req, locationId)

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
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated")
  }

  const { id, locationId } = req.params
  await verifyLocationAccess(req, locationId)

  await deleteInventoryLevelsWorkflow(req.scope).run({
    input: { inventory_item_id: id, location_id: locationId },
  })

  res.json({ id: `${id}-${locationId}`, object: "inventory_level", deleted: true })
}
