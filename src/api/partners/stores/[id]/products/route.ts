import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../helpers"
import listStoreProductsWorkflow from "../../../../../workflows/partner/list-store-products"
import type { IInventoryService } from "@medusajs/types"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { partner, store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const { result: links } = await listStoreProductsWorkflow(req.scope).run({
    input: {
      partnerId: partner.id,
      storeId: store.id,
    },
  })

  const products = ((links as any[]) || [])
    .map((l: any) => l?.product)
    .filter(Boolean)

  res.json({
    products,
    count: products.length,
    offset: 0,
    limit: 20,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const body = req.body as Record<string, any>

  // Inject the store's default sales channel
  if (store.default_sales_channel_id) {
    body.sales_channels = [{ id: store.default_sales_channel_id }]
  }

  const { result } = await createProductsWorkflow(req.scope).run({
    input: {
      products: [body] as any,
    },
  })

  const product = result[0]

  // Auto-link inventory items to the partner's stock location(s)
  // so they show up in the stock management page with inventory levels.
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const inventoryService = req.scope.resolve(Modules.INVENTORY) as IInventoryService

    // Find stock locations linked to the store's sales channel
    const locationIds: string[] = []

    if (store.default_sales_channel_id) {
      const { data: channels } = await query.graph({
        entity: "sales_channels",
        fields: ["stock_locations.id"],
        filters: { id: store.default_sales_channel_id },
      })
      const locs = channels?.[0]?.stock_locations || []
      for (const loc of locs) {
        if (loc?.id) locationIds.push(loc.id)
      }
    }

    if (locationIds.length > 0) {
      // Get all variants with manage_inventory=true from the created product
      const { data: products } = await query.graph({
        entity: "products",
        fields: [
          "variants.id",
          "variants.manage_inventory",
          "variants.inventory_items.inventory.id",
        ],
        filters: { id: product.id },
      })

      const variants = products?.[0]?.variants || []
      const inventoryItemIds: string[] = []

      for (const v of variants) {
        if (!v.manage_inventory) continue
        const items = v.inventory_items || []
        for (const ii of items) {
          if (ii?.inventory?.id) {
            inventoryItemIds.push(ii.inventory.id)
          }
        }
      }

      if (inventoryItemIds.length > 0) {
        // Create inventory levels for each item at each location
        const levelsToCreate: Array<{
          inventory_item_id: string
          location_id: string
          stocked_quantity?: number
        }> = []

        for (const itemId of inventoryItemIds) {
          // Check which locations already have levels
          const existingLevels = await inventoryService.listInventoryLevels({
            inventory_item_id: itemId,
          })
          const existingLocationIds = new Set(
            existingLevels.map((l: any) => l.location_id)
          )

          for (const locId of locationIds) {
            if (!existingLocationIds.has(locId)) {
              levelsToCreate.push({
                inventory_item_id: itemId,
                location_id: locId,
                stocked_quantity: 0,
              })
            }
          }
        }

        if (levelsToCreate.length > 0) {
          await inventoryService.createInventoryLevels(levelsToCreate)
        }
      }
    }
  } catch (e: any) {
    // Non-fatal: product was created successfully, log and continue
    console.error(
      "[partner-product-create] Failed to auto-link inventory to location:",
      e.message
    )
  }

  res.status(201).json({ product })
}
