import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"

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

  const body = req.body as Record<string, any>
  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any

  const results: any = {}

  if (body.create?.length) {
    results.created = await inventoryService.createInventoryLevels(body.create)
  }

  if (body.update?.length) {
    results.updated = []
    for (const u of body.update) {
      const updated = await inventoryService.updateInventoryLevels(
        { inventory_item_id: u.inventory_item_id, location_id: u.location_id },
        u
      )
      results.updated.push(updated)
    }
  }

  if (body.delete?.length) {
    for (const d of body.delete) {
      await inventoryService.deleteInventoryLevels(d)
    }
    results.deleted = body.delete
  }

  res.json(results)
}
