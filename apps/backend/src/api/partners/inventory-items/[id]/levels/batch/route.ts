import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { batchInventoryItemLevelsWorkflow } from "@medusajs/medusa/core-flows"
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

  const create = (body.create || [])
    .map((c: any) => ({
      ...c,
      inventory_item_id: id,
      location_id: c.location_id || partnerLocationId,
    }))
    .filter((c: any) => c.location_id === partnerLocationId)

  const update = (body.update || [])
    .map((u: any) => ({
      ...u,
      inventory_item_id: id,
      location_id: u.location_id || partnerLocationId,
    }))
    .filter((u: any) => u.location_id === partnerLocationId)

  // UI sends `delete` as a flat array of location ids (per-item manage locations
  // drawer). Resolve each to the matching inventory level row for this item,
  // then forward the level ids to the workflow.
  const deleteLocationIds: string[] = Array.isArray(body.delete) ? body.delete : []
  let allowedLevelIds: string[] = []
  if (deleteLocationIds.length > 0) {
    const allowedLocations = deleteLocationIds.filter(
      (locId) => locId === partnerLocationId
    )
    if (allowedLocations.length > 0) {
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
      const { data: levels } = await query.graph({
        entity: "inventory_level",
        fields: ["id"],
        filters: { inventory_item_id: id, location_id: allowedLocations },
      } as any)
      allowedLevelIds = (levels as any[]).map((l) => l.id)
    }
  }

  const { result } = await batchInventoryItemLevelsWorkflow(req.scope).run({
    input: {
      create,
      update,
      delete: allowedLevelIds,
      force: !!body.force,
    } as any,
  })

  res.json(result)
}
