import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../../../helpers"
import { PartnerUpdateFulfillmentProvidersReq } from "../../../validators"

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

  const body = PartnerUpdateFulfillmentProvidersReq.parse(req.body)

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any

  if (body.add?.length) {
    for (const providerId of body.add) {
      await remoteLink.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
        [Modules.FULFILLMENT]: { fulfillment_provider_id: providerId },
      })
    }
  }

  if (body.remove?.length) {
    for (const providerId of body.remove) {
      await remoteLink.dismiss({
        [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
        [Modules.FULFILLMENT]: { fulfillment_provider_id: providerId },
      })
    }
  }

  // Return updated location
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: locations } = await query.graph({
    entity: "stock_locations",
    fields: ["*", "address.*", "fulfillment_providers.*"],
    filters: { id: locationId },
  })

  res.json({ stock_location: locations?.[0] || { id: locationId } })
}
