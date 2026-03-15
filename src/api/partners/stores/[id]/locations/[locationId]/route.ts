import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { deleteStockLocationsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../../helpers"
import { PartnerUpdateLocationReq } from "../../validators"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const locationId = req.params.locationId
  if (store.default_location_id !== locationId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Location not found for this store"
    )
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
    filters: { id: locationId },
  })

  if (!locations?.[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Location not found")
  }

  res.json({ stock_location: locations[0] })
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

  const locationId = req.params.locationId
  if (store.default_location_id !== locationId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Location not found for this store"
    )
  }

  const body = PartnerUpdateLocationReq.parse(req.body)

  const locationService = req.scope.resolve(Modules.STOCK_LOCATION) as any
  const updated = await locationService.updateStockLocations(locationId, body)

  res.json({ stock_location: updated })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const locationId = req.params.locationId
  if (store.default_location_id !== locationId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Location not found for this store"
    )
  }

  await deleteStockLocationsWorkflow(req.scope).run({ input: { ids: [locationId] } })

  // Clear the store's default_location_id
  const storeService = req.scope.resolve(Modules.STORE) as any
  await storeService.updateStores(store.id, {
    default_location_id: null,
  })

  res.json({
    id: locationId,
    object: "stock_location",
    deleted: true,
  })
}
