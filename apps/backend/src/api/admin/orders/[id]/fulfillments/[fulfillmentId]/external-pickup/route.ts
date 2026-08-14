/**
 * POST /admin/orders/:id/fulfillments/:fulfillmentId/external-pickup
 *
 * Record a pickup that was booked OUTSIDE this app — on the carrier's own
 * dashboard, over the phone, or by a script — so the order knows its token.
 *
 * The manual twin of the `/pickup` route, and the pickup-side counterpart to
 * #1294's external-AWB attach. It makes **no carrier call at all**: the
 * collection is already booked, and re-registering it would send a second
 * courier. This only writes what an operator already has in hand.
 *
 * It exists because the gap is not hypothetical. Order 83's Blue Dart pickup
 * (token 4175751, 2026-08-17) was registered directly against the carrier while
 * `schedulePickup` was still broken — a real collection the order had no record
 * of, so the admin widget showed "the carrier won't collect until a pickup is
 * booked" for a courier that was already coming, and the only handle that can
 * cancel it lived in a terminal scrollback.
 *
 * ⚠️ Recording a pickup here does NOT book one. Nothing is sent to the carrier.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { persistPickupBookingSafely } from "../../../../../../../lib/persist-pickup-booking"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const body = (req.body || {}) as any

  const pickupDate = String(body.pickup_date || "").trim()
  const pickupTime = String(body.pickup_time || "").trim()
  const pickupId = String(body.pickup_id || "").trim()

  if (!pickupDate || !pickupTime) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "pickup_date and pickup_time are required"
    )
  }

  const { data: orders } = await query.graph({
    entity: "orders",
    fields: ["id", "fulfillments.*", "fulfillments.metadata"],
    filters: { id: req.params.id },
  })

  const fulfillment = (orders as any)?.[0]?.fulfillments?.find(
    (f: any) => f.id === req.params.fulfillmentId
  )

  if (!fulfillment) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Fulfillment not found")
  }

  const { persisted, record } = await persistPickupBookingSafely(
    req.scope,
    fulfillment.id,
    {
      pickup_id: pickupId || undefined,
      pickup_date: pickupDate,
      pickup_time: pickupTime,
      incoming_center_name: body.incoming_center_name,
      // Free-text on purpose: a pickup can be booked with a carrier this app
      // has no provider for. Same call as #1294's external AWB.
      carrier: body.carrier || fulfillment.data?.carrier,
    },
    fulfillment.metadata
  )

  res.json({ pickup: record, pickup_persisted: persisted })
}
