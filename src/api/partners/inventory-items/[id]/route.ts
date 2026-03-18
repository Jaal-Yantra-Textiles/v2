import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { deleteInventoryItemWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext, getPartnerStore } from "../../helpers"

/**
 * Verify the inventory item belongs to the partner's location
 */
async function verifyPartnerInventoryAccess(
  req: AuthenticatedMedusaRequest,
  itemId: string
): Promise<{ item: any; locationId: string }> {
  const { store } = await getPartnerStore(req.auth_context, req.scope)
  const locationId = store.default_location_id

  if (!locationId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No stock location configured for this store"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: items } = await query.graph({
    entity: "inventory_items",
    fields: ["*", "location_levels.*"],
    filters: { id: itemId },
  })

  const item = items?.[0] as any
  if (!item) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory item not found")
  }

  // Check item has a level at partner's location
  const hasLevel = (item.location_levels || []).some(
    (ll: any) => ll.location_id === locationId
  )

  if (!hasLevel) {
    // Also check if item is linked to partner's product variants
    const { data: scData } = await query.graph({
      entity: "sales_channel",
      fields: ["products_link.product.variants.inventory_items.inventory_item_id"],
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

    if (!variantItemIds.includes(itemId)) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Inventory item not found in your store"
      )
    }
  }

  // Filter levels to only partner's location
  item.location_levels = (item.location_levels || []).filter(
    (ll: any) => ll.location_id === locationId
  )

  return { item, locationId }
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated")
  }

  const { item } = await verifyPartnerInventoryAccess(req, req.params.id)
  res.json({ inventory_item: item })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated")
  }

  await verifyPartnerInventoryAccess(req, req.params.id)

  const body = req.body as Record<string, any>
  const inventoryService = req.scope.resolve(Modules.INVENTORY) as any
  const updated = await inventoryService.updateInventoryItems(req.params.id, body)

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

  await verifyPartnerInventoryAccess(req, req.params.id)

  await deleteInventoryItemWorkflow(req.scope).run({ input: [req.params.id] })
  res.json({ id: req.params.id, object: "inventory_item", deleted: true })
}
