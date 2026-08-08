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
 * (#641 parity) and optional parcel `weight_grams` / `dimensions_cm` — when
 * omitted the shipment falls back to the default weight, which is why every
 * label used to ship at 500 g regardless of the parcel.
 */

/** Coerce a body value to a positive number, or undefined (never 0/NaN). */
const positiveNumber = (v: unknown): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const orderId = req.params.id
  await validatePartnerOrderOwnership(req.auth_context, orderId, req.scope)

  const body = (req.body || {}) as {
    carrier?: string
    preferred_courier_id?: string | number
    weight_grams?: number
    dimensions_cm?: { length?: number; width?: number; height?: number }
  }
  const preferredCourierId =
    body.preferred_courier_id != null && body.preferred_courier_id !== ""
      ? body.preferred_courier_id
      : undefined

  const weightGrams = positiveNumber(body.weight_grams)
  // Dimensions are all-or-nothing at the carrier (a partial box is meaningless),
  // so only forward them when all three are present and positive.
  const dims = body.dimensions_cm || {}
  const length = positiveNumber(dims.length)
  const width = positiveNumber(dims.width)
  const height = positiveNumber(dims.height)
  const dimensionsCm =
    length && width && height ? { length, width, height } : undefined

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
    carrier: body.carrier,
    pickupStockLocationId: locationId,
    actingEmail: partner?.admins?.[0]?.email,
    preferredCourierId,
    weightGrams,
    dimensionsCm,
    // Carrier-account failures must read as something a PARTNER can act on —
    // "load courier credits or contact support", not "open the Shiprocket
    // dashboard" (they have no login for the shared platform account).
    audience: "partner",
  })

  res.status(200).json({ shiprocket_label: shipment })
}
