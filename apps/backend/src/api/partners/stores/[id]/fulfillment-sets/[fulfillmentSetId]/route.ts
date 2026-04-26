import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { deleteFulfillmentSetsWorkflow } from "@medusajs/medusa/core-flows"
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

  await deleteFulfillmentSetsWorkflow(req.scope).run({ input: { ids: [fulfillmentSetId] } })

  res.json({
    id: fulfillmentSetId,
    object: "fulfillment_set",
    deleted: true,
  })
}
