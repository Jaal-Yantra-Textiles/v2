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

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Get partner's store and location
  const { store } = await getPartnerStore(req.auth_context, req.scope)
  const locationId = store.default_location_id

  if (!locationId) {
    return res.json({ inventory_items: [], count: 0, offset: 0, limit: 20 })
  }

  // Strategy: get inventory items that have levels at the partner's location
  const { data: locationData } = await query.graph({
    entity: "stock_locations",
    fields: [
      "inventory_levels.inventory_item_id",
      "inventory_levels.stocked_quantity",
      "inventory_levels.reserved_quantity",
      "inventory_levels.incoming_quantity",
      "inventory_levels.location_id",
    ],
    filters: { id: locationId },
  })

  const levels = (locationData?.[0] as any)?.inventory_levels || []
  const itemIds = [...new Set(levels.map((l: any) => l.inventory_item_id).filter(Boolean))] as string[]

  if (itemIds.length === 0) {
    // Also check items linked to partner's product variants
    const { data: scData } = await query.graph({
      entity: "sales_channel",
      fields: [
        "products_link.product.variants.inventory_items.inventory_item_id",
      ],
      filters: { id: store.default_sales_channel_id },
    })

    const variantItemIds: string[] = []
    for (const link of ((scData?.[0] as any)?.products_link || [])) {
      for (const variant of (link?.product?.variants || [])) {
        for (const ii of (variant?.inventory_items || [])) {
          if (ii?.inventory_item_id) variantItemIds.push(ii.inventory_item_id)
        }
      }
    }

    if (variantItemIds.length === 0) {
      return res.json({ inventory_items: [], count: 0, offset: 0, limit: 20 })
    }

    itemIds.push(...variantItemIds)
  }

  const uniqueIds = [...new Set(itemIds)]

  // Fetch full inventory items
  const { data: items } = await query.graph({
    entity: "inventory_items",
    fields: [
      "*",
      "location_levels.*",
    ],
    filters: { id: uniqueIds },
  })

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
    // Non-critical — partner can add location level manually
  }

  res.status(201).json({ inventory_item: item })
}
