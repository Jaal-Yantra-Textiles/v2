import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { deleteInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext, getPartnerStore } from "../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated")
  }

  const { store } = await getPartnerStore(req.auth_context, req.scope)
  const partnerLocationId = store.default_location_id

  const { id } = req.params
  const body = req.body as Record<string, any>
  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any

  const results: any = {}

  if (body.create?.length) {
    // Force all creates to use the partner's location
    results.created = await inventoryService.createInventoryLevels(
      body.create.map((c: any) => ({
        ...c,
        inventory_item_id: id,
        location_id: c.location_id || partnerLocationId,
      }))
    )
  }

  if (body.update?.length) {
    results.updated = []
    for (const u of body.update) {
      // Only allow updating levels at partner's location
      const locationId = u.location_id || partnerLocationId
      if (locationId !== partnerLocationId) continue

      const updated = await inventoryService.updateInventoryLevels(
        { inventory_item_id: id, location_id: locationId },
        u
      )
      results.updated.push(updated)
    }
  }

  if (body.delete?.length) {
    for (const locationId of body.delete) {
      // Only allow deleting levels at partner's location
      if (locationId !== partnerLocationId) continue

      await deleteInventoryLevelsWorkflow(req.scope).run({
        input: { inventory_item_id: id, location_id: locationId },
      })
    }
    results.deleted = body.delete.filter((l: string) => l === partnerLocationId)
  }

  res.json(results)
}
