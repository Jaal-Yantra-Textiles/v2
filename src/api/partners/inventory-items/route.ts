import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext, getPartnerStore } from "../helpers"

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

  if (!locationId) {
    return res.json({ inventory_items: [], count: 0, offset: 0, limit: 20 })
  }

  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any

  // Get inventory levels at the partner's location to find their item IDs
  const [levels] = await inventoryService.listAndCountInventoryLevels(
    { location_id: locationId },
    { take: 1000 }
  )

  const itemIds = [...new Set((levels || []).map((l: any) => l.inventory_item_id).filter(Boolean))] as string[]

  if (itemIds.length === 0) {
    return res.json({ inventory_items: [], count: 0, offset: 0, limit: 20 })
  }

  // Fetch full inventory items with their levels (filtered to partner's location)
  const [items, count] = await inventoryService.listAndCountInventoryItems(
    { id: itemIds },
    { take: itemIds.length, relations: ["location_levels"] }
  )

  // Filter location_levels to only show the partner's location
  const scoped = (items || []).map((item: any) => ({
    ...item,
    location_levels: (item.location_levels || []).filter(
      (ll: any) => ll.location_id === locationId
    ),
  }))

  res.json({
    inventory_items: scoped,
    count: scoped.length,
    offset: 0,
    limit: scoped.length,
  })
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
