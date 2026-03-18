import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { deleteInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext, getPartnerStore } from "../../helpers"

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

  const body = req.body as Record<string, any>
  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any

  const results: any = {}

  if (body.create?.length) {
    // Force partner's location on all creates
    results.created = await inventoryService.createInventoryLevels(
      body.create.map((c: any) => ({
        ...c,
        location_id: c.location_id || partnerLocationId,
      }))
    )
  }

  if (body.update?.length) {
    results.updated = []
    for (const u of body.update) {
      if (u.location_id && u.location_id !== partnerLocationId) continue
      const updated = await inventoryService.updateInventoryLevels(
        {
          inventory_item_id: u.inventory_item_id,
          location_id: u.location_id || partnerLocationId,
        },
        u
      )
      results.updated.push(updated)
    }
  }

  if (body.delete?.length) {
    for (const d of body.delete) {
      if (d.location_id && d.location_id !== partnerLocationId) continue
      await deleteInventoryLevelsWorkflow(req.scope).run({
        input: {
          inventory_item_id: d.inventory_item_id,
          location_id: d.location_id || partnerLocationId,
        },
      })
    }
    results.deleted = body.delete.filter(
      (d: any) => !d.location_id || d.location_id === partnerLocationId
    )
  }

  res.json(results)
}
