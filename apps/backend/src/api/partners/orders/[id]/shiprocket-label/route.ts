import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { validatePartnerOrderOwnership } from "../../../helpers"
import { ensureOrderFulfillment } from "../../../../../workflows/orders/fulfillment-context"
import { createShiprocketShipmentForFulfillment } from "../../../../../workflows/orders/shiprocket-shipment"

/**
 * POST /partners/orders/:id/shiprocket-label
 *
 * #639 — partner mirror of `POST /admin/orders/:id/shiprocket-label`. Generates
 * a Shiprocket label (create fulfillment → shipment → AWB) for one of the
 * partner's own orders. Partner ownership is enforced INSIDE the handler via
 * `validatePartnerOrderOwnership` (retail sales-channel OR the D3 partner↔order
 * work link) — a foreign order 404s before any carrier work runs.
 *
 * Reuses the same `ensureOrderFulfillment` + `createShiprocketShipmentForFulfillment`
 * the admin route drives, so wire contract + behaviour match exactly. Accepts an
 * optional `preferred_courier_id` (#641 parity).
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const orderId = req.params.id
  await validatePartnerOrderOwnership(req.auth_context, orderId, req.scope)

  const body = (req.body || {}) as { preferred_courier_id?: string | number }
  const preferredCourierId =
    body.preferred_courier_id != null && body.preferred_courier_id !== ""
      ? body.preferred_courier_id
      : undefined

  const fulfillmentId = await ensureOrderFulfillment(req.scope, orderId)
  const shipment = await createShiprocketShipmentForFulfillment(req.scope, {
    orderId,
    fulfillmentId,
    preferredCourierId,
  })

  res.status(200).json({ shiprocket_label: shipment })
}
