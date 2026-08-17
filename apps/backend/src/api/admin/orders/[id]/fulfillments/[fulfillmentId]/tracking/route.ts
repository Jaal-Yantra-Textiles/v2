import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { getFulfillmentTracking } from "../../../../../../../workflows/orders/fulfillment-tracking"

/**
 * GET /admin/orders/:id/fulfillments/:fulfillmentId/tracking
 *
 * Ask the carrier where the parcel actually is.
 *
 * This existed for PARTNERS and nowhere else, which meant an in-house order had
 * no way to answer it at all. Order 83 sat uncollected for days with `shipped_at`
 * null and a Blue Dart waybill; the only question that mattered — "has it been
 * picked up?" — could not be asked from inside the system, so it was answered by
 * waiting for someone to say so.
 *
 * Read-only: no carrier state is changed, nothing is booked or cancelled. It
 * does spend a carrier API call (and, per `resolveShippingProvider`, mints a
 * fresh token to do it), so it is a request, not a poll.
 *
 * `source` says whether the answer came from the carrier or was synthesised from
 * our own timestamps — the two look alike and mean very different things.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const tracking = await getFulfillmentTracking(
    req.scope,
    req.params.id,
    req.params.fulfillmentId
  )

  res.json(tracking)
}
