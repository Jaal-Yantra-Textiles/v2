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

import {
  isSupportedCarrier,
  resolveShippingProvider,
  shipmentRefFromFulfillment,
} from "../../../../../../../modules/shipping-providers/resolver"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: "orders",
    fields: ["id", "fulfillments.*", "fulfillments.labels.*"],
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
  })

  const raw = (result.raw as Record<string, any>) || {}
  res.json({
    pickup_id: raw.pickup_id,
    pickup_date: pickupDate,
    pickup_time: pickupTime,
    incoming_center_name: raw.incoming_center_name,
    ...raw,
  })
}
