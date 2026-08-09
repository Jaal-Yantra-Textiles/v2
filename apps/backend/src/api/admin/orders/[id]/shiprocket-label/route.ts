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
/** Coerce a body value to a positive number, or undefined (never 0/NaN). */
const positiveNumber = (v: unknown): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.id
  // #641 — the Design-Orders courier picker passes the chosen courier id; when
  // omitted, Shiprocket auto-assigns on AWB generation (prior behaviour).
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

  // Parcel details, mirroring the partner route. Without them every admin label
  // shipped at the default weight regardless of the real box — and the rate the
  // courier picker quoted (which HAS taken weight + dimensions all along)
  // described a different parcel than the one that actually went out.
  const weightGrams = positiveNumber(body.weight_grams)
  // All-or-nothing at the carrier: a partial box can't be turned into a volume,
  // and guessing the missing side silently changes the price.
  const dims = body.dimensions_cm || {}
  const length = positiveNumber(dims.length)
  const width = positiveNumber(dims.width)
  const height = positiveNumber(dims.height)
  const dimensionsCm =
    length && width && height ? { length, width, height } : undefined

  const fulfillmentId = await ensureOrderFulfillment(req.scope, orderId)

  const shipment = await createShiprocketShipmentForFulfillment(req.scope, {
    orderId,
    fulfillmentId,
    carrier: body.carrier,
    preferredCourierId,
    weightGrams,
    dimensionsCm,
  })

  res.status(200).json({ shiprocket_label: shipment })
}
