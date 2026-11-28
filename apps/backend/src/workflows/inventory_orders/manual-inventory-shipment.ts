import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { FULLFILLED_ORDERS_MODULE } from "../../modules/fullfilled_orders"
import InventoryOrdersStockLocationsLink from "../../links/inventory-orders-stock-locations"
import { resolveExternalTrackingUrl } from "../orders/external-awb"
import { isManualBookingCarrier } from "./lib/manual-carriers"
import { INVENTORY_SHIPMENT_STATUS_CHANGED_EVENT } from "./sync-inventory-shipment-tracking"

/**
 * Manual-carrier shipments for inventory orders (India Post, until its API is
 * whitelisted).
 *
 * 1. The partner REQUESTS: `requestManualInventoryShipment` stores what they
 *    submitted as a `booking_pending` shipment with no AWB. No carrier API is
 *    called and nothing claims the parcel is out.
 * 2. Staff book it on the carrier's side, then COMPLETE it:
 *    `completeManualInventoryShipment` fills the AWB, tracking link and label
 *    on that same row, moves it to `created`, and tells the partner.
 *
 * Only staff complete a booking: asserting a parcel has an AWB is a claim only
 * staff should make (same rule as the external-AWB attach).
 */

export type RequestManualInventoryShipmentInput = {
  orderId: string
  carrier: string
  pickupStockLocationId?: string
  weightGrams?: number
  dimensionsCm?: Record<string, number | undefined>
  pickupDate?: string
  notes?: string
  /** Partner admin email, recorded on the request. */
  actingEmail?: string
  partnerId?: string
}

export type PendingInventoryShipment = {
  id: string
  carrier: string
  status: "booking_pending"
  awb: null
  pending: true
}

export async function requestManualInventoryShipment(
  container: MedusaContainer,
  input: RequestManualInventoryShipmentInput
): Promise<PendingInventoryShipment> {
  const carrier = String(input.carrier || "").trim().toLowerCase()
  if (!isManualBookingCarrier(carrier)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${carrier || "(none)"} is not a manually booked carrier`
    )
  }

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "inventory_orders",
    fields: ["id", "inventory_shipments.id", "inventory_shipments.status", "inventory_shipments.carrier"],
    filters: { id: input.orderId },
  })
  const order = data?.[0]
  if (!order) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inventory order ${input.orderId} not found`)
  }
  // One open request per carrier: a second tap must not queue a second
  // booking for staff to do twice.
  const open = ((order.inventory_shipments || []) as any[]).find(
    (s) => s?.status === "booking_pending" && s?.carrier === carrier
  )
  if (open) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `A ${carrier} booking request is already waiting on this order (shipment ${open.id}).`
    )
  }

  // Pickup = what the partner chose, else the order's own source location.
  let pickupStockLocationId = input.pickupStockLocationId
  if (!pickupStockLocationId) {
    try {
      const { data: links } = await query.graph({
        entity: (InventoryOrdersStockLocationsLink as any).entryPoint,
        fields: ["from_location", "stock_location.id"],
        filters: { inventory_orders_id: order.id },
      })
      pickupStockLocationId =
        (links || []).find((l: any) => l?.from_location)?.stock_location?.id || undefined
    } catch {
      // best-effort: staff see the order's locations anyway
    }
  }

  const requestedAt = new Date().toISOString()
  const manualBooking = {
    requested_by: input.actingEmail ?? null,
    requested_by_partner_id: input.partnerId ?? null,
    requested_at: requestedAt,
    pickup_date: input.pickupDate ?? null,
    notes: input.notes ?? null,
  }

  const fulfilledOrders: any = container.resolve(FULLFILLED_ORDERS_MODULE)
  const record = await fulfilledOrders.createInventoryShipments({
    carrier,
    awb: null,
    tracking_number: null,
    tracking_url: null,
    label_url: null,
    pickup_stock_location_id: pickupStockLocationId ?? null,
    status: "booking_pending",
    weight_grams: input.weightGrams ?? null,
    dimensions_cm: input.dimensionsCm ?? null,
    metadata: { manual_booking: manualBooking },
  })
  const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
  await remoteLink.create([
    {
      [ORDER_INVENTORY_MODULE]: { inventory_orders_id: order.id },
      [FULLFILLED_ORDERS_MODULE]: { inventory_shipment_id: record.id },
    },
  ])

  // Timeline. Deliberately NOT the metadata.shipment mirror: a request is not
  // a shipment, and must not overwrite a real earlier AWB there.
  try {
    const inventoryOrders: any = container.resolve(ORDER_INVENTORY_MODULE)
    await inventoryOrders.createInventoryOrderActivities({
      inventory_order_id: order.id,
      activity_type: "lifecycle_event",
      kind: "shipment_booking_requested",
      actor_type: "partner",
      actor_id: input.actingEmail ?? input.partnerId ?? null,
      summary:
        `${carrierLabel(carrier)} booking requested: waiting for the team to book it` +
        (input.notes ? ` (${input.notes})` : ""),
      payload: { shipment_id: record.id, carrier, ...manualBooking },
    })
  } catch (e) {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.warn(`Manual booking ${record.id} saved but the activity row failed: ${(e as Error)?.message}`)
  }

  return { id: record.id, carrier, status: "booking_pending", awb: null, pending: true }
}

export type CompleteManualInventoryShipmentInput = {
  orderId: string
  shipmentId: string
  awb: string
  trackingUrl?: string
  labelUrl?: string
  notes?: string
  /** Admin email recorded on the booking. */
  actingEmail?: string
}

export async function completeManualInventoryShipment(
  container: MedusaContainer,
  input: CompleteManualInventoryShipmentInput
) {
  const awb = String(input.awb || "").trim()
  if (!awb) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "An AWB is required")
  }

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "inventory_orders",
    fields: ["id", "metadata", "inventory_shipments.*"],
    filters: { id: input.orderId },
  })
  const order = data?.[0]
  if (!order) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inventory order ${input.orderId} not found`)
  }
  const shipments = (order.inventory_shipments || []) as any[]
  const shipment = shipments.find((s) => s?.id === input.shipmentId)
  if (!shipment) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Shipment ${input.shipmentId} is not on inventory order ${input.orderId}`
    )
  }
  if (shipment.status !== "booking_pending") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Shipment ${shipment.id} is '${shipment.status}', not waiting for a booking.`
    )
  }
  const clash = shipments.find((s) => s?.id !== shipment.id && s?.awb === awb && s?.status !== "cancelled")
  if (clash) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `AWB ${awb} is already on this order (shipment ${clash.id}).`
    )
  }

  const carrier = String(shipment.carrier)
  const trackingUrl = resolveExternalTrackingUrl(carrier, awb, input.trackingUrl) || null
  const bookedAt = new Date().toISOString()
  const manualBooking = {
    ...((shipment.metadata as any)?.manual_booking || {}),
    booked_by: input.actingEmail ?? null,
    booked_at: bookedAt,
    ...(input.notes ? { booking_notes: input.notes } : {}),
  }

  const fulfilledOrders: any = container.resolve(FULLFILLED_ORDERS_MODULE)
  await fulfilledOrders.updateInventoryShipments({
    id: shipment.id,
    awb,
    tracking_number: awb,
    tracking_url: trackingUrl,
    label_url: input.labelUrl ?? null,
    status: "created",
    metadata: { ...(shipment.metadata || {}), manual_booking: manualBooking },
  })

  // Back-compat mirror, now that there is a real AWB.
  const inventoryOrders: any = container.resolve(ORDER_INVENTORY_MODULE)
  await inventoryOrders.updateInventoryOrders({
    id: order.id,
    metadata: {
      ...((order.metadata as Record<string, any>) || {}),
      partner_tracking_number: awb,
      shipment: {
        carrier,
        awb,
        tracking_number: awb,
        tracking_url: trackingUrl,
        label_url: input.labelUrl ?? null,
        shipment_id: shipment.id,
        created_at: bookedAt,
        manual: true,
      },
    },
  })

  try {
    await inventoryOrders.createInventoryOrderActivities({
      inventory_order_id: order.id,
      activity_type: "lifecycle_event",
      kind: "shipment_booked_manually",
      actor_type: "admin",
      actor_id: input.actingEmail ?? null,
      summary: `${carrierLabel(carrier)} booked by the team: AWB ${awb}`,
      payload: { shipment_id: shipment.id, awb, carrier, tracking_url: trackingUrl, label_url: input.labelUrl ?? null },
    })
  } catch {
    /* best-effort */
  }

  // Tell the partner's side the shipment moved (visual flows, notifications).
  try {
    const eventBus: any = container.resolve(Modules.EVENT_BUS)
    await eventBus.emit({
      name: INVENTORY_SHIPMENT_STATUS_CHANGED_EVENT,
      data: {
        id: shipment.id,
        awb,
        carrier,
        previous_status: "booking_pending",
        status: "created",
        order_id: order.id,
        pickup_scheduled_date: null,
      },
    })
  } catch {
    /* best-effort */
  }

  return {
    id: shipment.id,
    carrier,
    awb,
    status: "created" as const,
    tracking_url: trackingUrl,
    label_url: input.labelUrl ?? null,
  }
}

export function carrierLabel(carrier: string): string {
  const c = String(carrier || "").toLowerCase()
  if (c === "india_post") return "India Post"
  if (c === "dtdc") return "DTDC"
  return c.charAt(0).toUpperCase() + c.slice(1)
}
