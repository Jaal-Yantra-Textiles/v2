import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext, getPartnerStore, tryGetPartnerStore } from "../helpers"
import { listPartnerInventoryItemsWorkflow } from "../../../workflows/inventory/list-partner-inventory-items"

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

  const { store } = await tryGetPartnerStore(req.auth_context, req.scope)
  if (!store) {
    return res.json({ inventory_items: [], count: 0, offset: 0, limit: 20 })
  }

  const locationId = store.default_location_id

  if (!locationId) {
    return res.json({ inventory_items: [], count: 0, offset: 0, limit: 20 })
  }

  const qv = (req.validatedQuery ?? req.query ?? {}) as Record<string, any>
  const q = typeof qv.q === "string" ? qv.q.trim() : ""
  const limit = Number.isFinite(Number(qv.limit)) ? Number(qv.limit) : 20
  const offset = Number.isFinite(Number(qv.offset)) ? Number(qv.offset) : 0

  // Auth + "which location is theirs" is all this route contributes — the
  // listing itself belongs to the workflow so the admin inspection mirror runs
  // the same code rather than a second copy of it (#843).
  const { result } = await listPartnerInventoryItemsWorkflow(req.scope).run({
    input: { locationId, q, offset, limit },
  })

  res.json(result)
}

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
  const item = await inventoryService.createInventoryItems(body)

  // Auto-create a level at the partner's location
  try {
    const { store } = await getPartnerStore(req.auth_context, req.scope)
    if (store.default_location_id) {
      await inventoryService.createInventoryLevels([{
        inventory_item_id: item.id,
        location_id: store.default_location_id,
        stocked_quantity: 0,
      }])
    }
  } catch {
    // Non-critical
  }

  res.status(201).json({ inventory_item: item })
}
