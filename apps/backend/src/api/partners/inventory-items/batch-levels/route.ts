import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { batchInventoryItemLevelsWorkflow } from "@medusajs/medusa/core-flows"
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

  // Normalize create/update: force the partner's default location, drop
  // entries that try to write to a different location. Keeps the stock
  // write surface scoped to the partner's own warehouse.
  const create = (body.create || [])
    .map((c: any) => ({
      ...c,
      location_id: c.location_id || partnerLocationId,
    }))
    .filter((c: any) => c.location_id === partnerLocationId)

  const update = (body.update || [])
    .map((u: any) => ({
      ...u,
      location_id: u.location_id || partnerLocationId,
    }))
    .filter((u: any) => u.location_id === partnerLocationId)

  // UI sends `delete` as a flat array of level ids (ilev_*). Resolve each id
  // to its level row first so we can verify it belongs to the partner's
  // location before handing it off to the workflow.
  const deleteIds: string[] = Array.isArray(body.delete) ? body.delete : []
  let allowedDeleteIds: string[] = []
  if (deleteIds.length > 0) {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: levels } = await query.graph({
      entity: "inventory_level",
      fields: ["id", "location_id"],
      filters: { id: deleteIds },
    } as any)
    allowedDeleteIds = (levels as any[])
      .filter((l) => l.location_id === partnerLocationId)
      .map((l) => l.id)
  }

  const { result } = await batchInventoryItemLevelsWorkflow(req.scope).run({
    input: {
      create,
      update,
      delete: allowedDeleteIds,
      force: !!body.force,
    } as any,
  })

  res.json(result)
}
