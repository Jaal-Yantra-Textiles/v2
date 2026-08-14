/**
 * POST /admin/orders/:id/fulfillments/:fulfillmentId/pickup
 *
 * Schedule the carrier pickup for a fulfillment. The admin twin of
 * `/partners/orders/:id/fulfillments/:fulfillmentId/pickup`, which existed while
 * the admin side had nothing — so an admin-created shipment sat waiting until
 * someone booked the pickup by hand on the carrier's dashboard. Order #83's
 * first real shipment was collected two days late for exactly this reason.
 *
 * Creating the waybill and scheduling the pickup are deliberately separate
 * calls: a manifest can be created the evening before, while the pickup slot is
 * a real-world commitment for a particular date, count and warehouse. Booking
 * one automatically on every fulfillment would send couriers to locations that
 * are not packed yet.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { persistPickupBookingSafely } from "../../../../../../../lib/persist-pickup-booking"
import { resolveOriginAddress } from "../../../../../../../modules/shipping-providers/origin-address"
import {
  isSupportedCarrier,
  resolveShippingProvider,
  shipmentRefFromFulfillment,
} from "../../../../../../../modules/shipping-providers/resolver"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: "orders",
    fields: [
      "id",
      "fulfillments.*",
      "fulfillments.labels.*",
      "fulfillments.metadata",
    ],
    filters: { id: req.params.id },
  })

  const order = (orders as any)?.[0]
  const fulfillment = order?.fulfillments?.find(
    (f: any) => f.id === req.params.fulfillmentId
  )

  if (!fulfillment) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Fulfillment not found")
  }

  const carrier = fulfillment.data?.carrier
  if (!isSupportedCarrier(carrier)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Pickup scheduling is not available for this shipment's carrier"
    )
  }

  const locationId = fulfillment.location_id
  if (!locationId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No stock location associated with this fulfillment"
    )
  }

  const { data: locations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "metadata"],
    filters: { id: locationId },
  })

  const location = (locations as any)?.[0]
  const warehouseName =
    location?.metadata?.delhivery_warehouse_name ||
    fulfillment.data?.pickup_location_name

  // Delhivery schedules per registered warehouse; aggregators (Shiprocket)
  // schedule per shipment via the ref, so only Delhivery hard-requires a name.
  if (carrier === "delhivery" && !warehouseName) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No Delhivery warehouse registered for this location"
    )
  }

  const body = (req.body || {}) as any
  const pickupDate = body.pickup_date
  const pickupTime = body.pickup_time

  if (!pickupDate || !pickupTime) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "pickup_date and pickup_time are required"
    )
  }

  const provider = await resolveShippingProvider(req.scope, carrier)
  if (!provider.schedulePickup) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Pickup scheduling is not supported by ${carrier}`
    )
  }

  const result = await provider.schedulePickup({
    pickup_location_name: warehouseName,
    pickup_date: pickupDate,
    pickup_time: pickupTime,
    expected_package_count: body.expected_package_count || 1,
    ref: shipmentRefFromFulfillment(fulfillment.data),
    // Blue Dart carries the collection address inline — see SchedulePickupInput.
    // Carriers with a pickup registry ignore this, so it can only add detail.
    from: await resolveOriginAddress(req.scope, locationId),
  })

  const raw = (result.raw as Record<string, any>) || {}
  // `result.token` is the normalized fallback: Blue Dart returns its handle as
  // `TokenNumber`, not `pickup_id`, and that token is the only thing that can
  // call the collection off later. Dropping it means a pickup can be booked
  // and then only cancelled by phone.
  const pickupId = raw.pickup_id || result.token

  // Best-effort: the carrier has already committed to the collection, so a
  // failed write must not surface as "pickup failed" and send the operator to
  // book a second one.
  const { persisted, record } = await persistPickupBookingSafely(
    req.scope,
    fulfillment.id,
    {
      pickup_id: pickupId,
      pickup_date: pickupDate,
      pickup_time: pickupTime,
      incoming_center_name: raw.incoming_center_name,
      carrier,
    },
    fulfillment.metadata
  )

  res.json({
    pickup_id: pickupId,
    pickup_date: pickupDate,
    pickup_time: pickupTime,
    incoming_center_name: raw.incoming_center_name,
    // `false` means the booking is live at the carrier but this order no longer
    // knows its token — the UI must say so rather than render a clean success.
    pickup_persisted: persisted,
    booked_at: record.booked_at,
    ...raw,
  })
}
