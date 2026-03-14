import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../../helpers"

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const { fulfillmentSetId } = req.params

  const fulfillmentService = req.scope.resolve(Modules.FULFILLMENT) as any
  await fulfillmentService.deleteFulfillmentSets(fulfillmentSetId)

  res.json({
    id: fulfillmentSetId,
    object: "fulfillment_set",
    deleted: true,
  })
}
