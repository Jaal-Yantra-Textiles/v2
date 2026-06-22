import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { validatePartnerOrderOwnership } from "../../../helpers"
import { ensureOrderFulfillment } from "../../../../../workflows/orders/fulfillment-context"
import { attachExistingShiprocketAwb } from "../../../../../workflows/orders/shiprocket-attach-awb"

/**
 * POST /partners/orders/:id/shiprocket-attach-awb
 *
 * #639 — partner mirror of `POST /admin/orders/:id/shiprocket-attach-awb`.
 * Attaches an EXISTING Shiprocket AWB (parcel shipped outside this system) to
 * one of the partner's own orders: reuses/creates a manual fulfillment, looks
 * the AWB up on Shiprocket (read-only), stamps the carrier refs, and syncs the
 * fulfillment status. Partner ownership is enforced INSIDE the handler via
 * `validatePartnerOrderOwnership` before any carrier work runs.
 */
const Body = z.object({ awb: z.string().trim().min(1, "An AWB is required") })

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const orderId = req.params.id
  await validatePartnerOrderOwnership(req.auth_context, orderId, req.scope)

  const { awb } = Body.parse((req.body as Record<string, unknown>) ?? {})

  const fulfillmentId = await ensureOrderFulfillment(req.scope, orderId)
  const result = await attachExistingShiprocketAwb(req.scope, {
    orderId,
    fulfillmentId,
    awb,
  })

  res.status(200).json({ shiprocket_awb: result })
}
