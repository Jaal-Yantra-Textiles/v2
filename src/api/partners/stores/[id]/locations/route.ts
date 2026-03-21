import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  if (!store.default_sales_channel_id) {
    // Fallback: return just the default location if no sales channel is set
    if (!store.default_location_id) {
      return res.json({ stock_locations: [], count: 0, offset: 0, limit: 20 })
    }
    const { data: locations } = await query.graph({
      entity: "stock_locations",
      fields: ["*", "address.*"],
      filters: { id: store.default_location_id },
    })
    return res.json({
      stock_locations: locations || [],
      count: locations?.length || 0,
      offset: 0,
      limit: 20,
    })
  }

  // Get all stock locations linked to this partner's sales channel(s)
  // This uses the sales_channel_stock_location link table for partner scoping
  const { data: channels } = await query.graph({
    entity: "sales_channels",
    fields: [
      "stock_locations.*",
      "stock_locations.address.*",
      "stock_locations.sales_channels.*",
      "stock_locations.fulfillment_sets.id",
      "stock_locations.fulfillment_sets.name",
      "stock_locations.fulfillment_sets.type",
      "stock_locations.fulfillment_sets.service_zones.*",
      "stock_locations.fulfillment_sets.service_zones.geo_zones.*",
      "stock_locations.fulfillment_sets.service_zones.shipping_options.*",
      "stock_locations.fulfillment_providers.*",
    ],
    filters: { id: store.default_sales_channel_id },
  })

  const locations = channels?.[0]?.stock_locations || []

  // Also include the default location if it's not already in the list
  if (store.default_location_id) {
    const hasDefault = locations.some((l: any) => l.id === store.default_location_id)
    if (!hasDefault) {
      const { data: defaultLocations } = await query.graph({
        entity: "stock_locations",
        fields: [
          "*",
          "address.*",
          "sales_channels.*",
          "fulfillment_sets.id",
          "fulfillment_sets.name",
          "fulfillment_sets.type",
          "fulfillment_sets.service_zones.*",
          "fulfillment_sets.service_zones.geo_zones.*",
          "fulfillment_sets.service_zones.shipping_options.*",
          "fulfillment_providers.*",
        ],
        filters: { id: store.default_location_id },
      })
      if (defaultLocations?.[0]) {
        locations.unshift(defaultLocations[0])
      }
    }
  }

  res.json({
    stock_locations: locations,
    count: locations.length,
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

  const locationService = req.scope.resolve(Modules.STOCK_LOCATION) as any
  const location = await locationService.createStockLocations(body)

  // Update store's default_location_id if not already set
  if (!store.default_location_id) {
    const storeService = req.scope.resolve(Modules.STORE) as any
    await storeService.updateStores(store.id, {
      default_location_id: location.id,
    })
  }

  res.status(201).json({ stock_location: location })
}
