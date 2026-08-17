import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { validatePartnerOrderOwnership } from "../../../../../helpers"
import { getFulfillmentTracking } from "../../../../../../../workflows/orders/fulfillment-tracking"

/**
 * GET /partners/orders/:id/fulfillments/:fulfillmentId/tracking
 *
 * Same answer as the admin route, behind an ownership check. The body lives in
 * `getFulfillmentTracking` because the fallback timeline is the kind of code
 * that drifts silently when copied — both copies keep returning something
 * plausible.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const tracking = await getFulfillmentTracking(
    req.scope,
    req.params.id,
    req.params.fulfillmentId
  )

  res.json(tracking)
}
