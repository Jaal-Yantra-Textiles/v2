import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  resolvePartnerShipFromLocation,
  validatePartnerOrderOwnership,
} from "../../../helpers"
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
 * Ship-from = the PARTNER'S OWN stock location (#772 core-order half): the
 * location linked to their default sales channel, recorded on the fulfillment
 * and registered as the carrier pickup on the fly. Unlike the admin route
 * there is deliberately NO registered-pickup fallback — all parties share one
 * Shiprocket account, so the #638 fallback would print a label originating at
 * another party's warehouse. Accepts an optional `preferred_courier_id`
 * (#641 parity).
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

  const { partner, locationId } = await resolvePartnerShipFromLocation(
    req.auth_context,
    req.scope
  )
  if (!locationId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No stock location is linked to your sales channel to ship from. Add a location (with phone + pincode) to your store before generating a label."
    )
  }

  const fulfillmentId = await ensureOrderFulfillment(req.scope, orderId, {
    locationId,
  })
  const shipment = await createShiprocketShipmentForFulfillment(req.scope, {
    orderId,
    fulfillmentId,
    pickupStockLocationId: locationId,
    actingEmail: partner?.admins?.[0]?.email,
    preferredCourierId,
  })

  res.status(200).json({ shiprocket_label: shipment })
}
