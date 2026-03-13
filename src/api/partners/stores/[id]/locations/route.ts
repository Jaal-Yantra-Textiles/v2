import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
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

  if (!store.default_location_id) {
    return res.json({
      stock_locations: [],
      count: 0,
      offset: 0,
      limit: 20,
    })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: locations } = await query.graph({
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

  res.json({
    stock_locations: locations || [],
    count: locations?.length || 0,
    offset: 0,
    limit: 20,
  })
}
