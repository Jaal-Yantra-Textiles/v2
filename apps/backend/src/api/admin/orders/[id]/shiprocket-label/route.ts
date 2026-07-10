import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureOrderFulfillment } from "../../../../../workflows/orders/fulfillment-context"
import { createShiprocketShipmentForFulfillment } from "../../../../../workflows/orders/shiprocket-shipment"

/**
 * POST /admin/orders/:id/shiprocket-label
 *
 * #404 (#31) PR-C convenience endpoint — one click from the Design Orders UI:
 * create a fulfillment for the whole order (reusing an existing Shiprocket
 * fulfillment if one's already there) and generate the Shiprocket shipment +
 * label off it. Returns the AWB + label URL.
 *
 * Fulfillment creation for converted (title-only, shipping-method-less) orders
 * is handled by `ensureOrderFulfillment` — it creates the plain fulfillment
 * against the MANUAL provider so this route's createShipment is the only thing
 * that touches Shiprocket (#437).
 *
 * Errors (incl. Shiprocket's ShiprocketApiError, a MedusaError #427) surface
 * cleanly to the UI toast.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.id
  // #641 — the Design-Orders courier picker passes the chosen courier id; when
  // omitted, Shiprocket auto-assigns on AWB generation (prior behaviour).
  const body = (req.body || {}) as {
    carrier?: string
    preferred_courier_id?: string | number
  }
  const preferredCourierId =
    body.preferred_courier_id != null && body.preferred_courier_id !== ""
      ? body.preferred_courier_id
      : undefined

  const fulfillmentId = await ensureOrderFulfillment(req.scope, orderId)

  const shipment = await createShiprocketShipmentForFulfillment(req.scope, {
    orderId,
    fulfillmentId,
    carrier: body.carrier,
    preferredCourierId,
  })

  res.status(200).json({ shiprocket_label: shipment })
}
