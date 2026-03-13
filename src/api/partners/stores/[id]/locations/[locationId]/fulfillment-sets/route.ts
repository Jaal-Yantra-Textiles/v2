import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../../../helpers"
import { PartnerCreateFulfillmentSetReq } from "../../../validators"

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

  const body = PartnerCreateFulfillmentSetReq.parse(req.body)

  const fulfillmentService = req.scope.resolve(Modules.FULFILLMENT) as any
  const fulfillmentSet = await fulfillmentService.createFulfillmentSets(body)

  // Link the fulfillment set to the stock location
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
  })

  res.status(201).json({ stock_location: { id: locationId }, fulfillment_set: fulfillmentSet })
}
