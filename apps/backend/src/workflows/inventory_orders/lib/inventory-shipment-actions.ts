import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { FULLFILLED_ORDERS_MODULE } from "../../../modules/fullfilled_orders"
import { isSupportedCarrier, resolveShippingProvider } from "../../../modules/shipping-providers/resolver"
import { isManualBookingCarrier } from "./manual-carriers"
import { labelBase64, storeLabelPdf } from "./store-label-pdf"
import { INVENTORY_SHIPMENT_STATUS_CHANGED_EVENT } from "../sync-inventory-shipment-tracking"

/** Delhivery requires a pickup time; mid-afternoon suits most workshops. */
export const DEFAULT_SHIPMENT_PICKUP_TIME = "14:00"

/**
 * The shipment row, but only through the order it belongs to — a shipment id
 * from someone else's order is a 404, never another partner's label.
 */
export async function loadOrderShipment(
  container: MedusaContainer,
  orderId: string,
  shipmentId: string
): Promise<Record<string, any>> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "inventory_orders",
    fields: ["id", "inventory_shipments.*"],
    filters: { id: orderId },
  })
  const shipment = ((data?.[0]?.inventory_shipments ?? []) as any[]).find((s) => s?.id === shipmentId)
  if (!shipment) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Shipment ${shipmentId} not found on order ${orderId}`)
  }
  return shipment
}

/**
 * A fresh printable label. Delhivery's PDF link is signed for 24 hours, so it
 * is fetched on every ask rather than read from the row. Falls back to the
 * stored label_url (Shiprocket returns a lasting one at create).
 */
export async function freshShipmentLabel(
  container: MedusaContainer,
  shipment: Record<string, any>
): Promise<{ label_url: string | null; format: string | null; expires_in_hours: number | null }> {
  if (shipment.status === "cancelled") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This shipment was cancelled; it has no label.")
  }
  if (shipment.status === "booking_pending") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This shipment is waiting to be booked; its label appears once the team books it."
    )
  }
  // Manual carriers (India Post) and anything without a carrier client have
  // only what staff stored: never call a carrier API that does not exist.
  if (isManualBookingCarrier(shipment.carrier) || !isSupportedCarrier(shipment.carrier)) {
    return { label_url: shipment.label_url ?? null, format: shipment.label_url ? "pdf" : null, expires_in_hours: null }
  }
  // A label already stored (Shiprocket's lasting link, a saved DTDC PDF) is
  // served as-is, except Delhivery's, whose signed link expires.
  if (shipment.label_url && shipment.carrier !== "delhivery") {
    return { label_url: shipment.label_url, format: "pdf", expires_in_hours: null }
  }
  const provider: any = await resolveShippingProvider(container, shipment.carrier)
  if (provider?.getLabel && shipment.awb) {
    const label = await provider.getLabel({ awb: shipment.awb, provider_refs: shipment.provider_refs ?? undefined })
    if (label?.label_url && label.format !== "tracking_page") {
      return {
        label_url: label.label_url,
        format: label.format ?? "pdf",
        expires_in_hours: shipment.carrier === "delhivery" ? 24 : null,
      }
    }
    // DTDC returns the PDF bytes: store them once and keep the link.
    const bytes = labelBase64(label)
    if (bytes) {
      const url = await storeLabelPdf(container, { awb: String(shipment.awb), base64: bytes })
      try {
        const fulfilled: any = container.resolve(FULLFILLED_ORDERS_MODULE)
        await fulfilled.updateInventoryShipments({ id: shipment.id, label_url: url })
      } catch {
        /* the link is still returned */
      }
      return { label_url: url, format: "pdf", expires_in_hours: null }
    }
  }
  return { label_url: shipment.label_url ?? null, format: shipment.label_url ? "pdf" : null, expires_in_hours: null }
}

/**
 * Book (or re-book) the carrier pickup for an existing shipment and record it.
 * Returns the carrier's own words when it refuses, so the screen can say why.
 */
export async function bookShipmentPickup(
  container: MedusaContainer,
  input: { orderId: string; shipment: Record<string, any>; pickupDate: string; pickupTime?: string }
): Promise<{ scheduled: boolean; pickup_date: string | null; pickup_time: string | null; reason: string | null }> {
  const { shipment } = input
  if (shipment.status === "cancelled") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This shipment was cancelled; book a new one instead.")
  }
  if (shipment.status === "booking_pending" || isManualBookingCarrier(shipment.carrier)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This carrier is booked by the team, pickup included; there is nothing to schedule here."
    )
  }
  if (!shipment.pickup_location_name) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "This shipment has no pickup location recorded.")
  }
  if (!isSupportedCarrier(shipment.carrier)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `${shipment.carrier} pickups are booked on the carrier's side.`)
  }
  const provider: any = await resolveShippingProvider(container, shipment.carrier)
  if (!provider?.schedulePickup) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `${shipment.carrier} pickups are booked on the carrier's side.`)
  }
  const pickupTime = input.pickupTime || DEFAULT_SHIPMENT_PICKUP_TIME
  try {
    const res = await provider.schedulePickup({
      pickup_location_name: shipment.pickup_location_name,
      pickup_date: input.pickupDate,
      pickup_time: pickupTime,
      expected_package_count: 1,
      ref: { awb: shipment.awb, provider_refs: shipment.provider_refs ?? undefined },
    })
    const date = res?.scheduled_date ?? input.pickupDate
    const fulfilled: any = container.resolve(FULLFILLED_ORDERS_MODULE)
    await fulfilled.updateInventoryShipments({
      id: shipment.id,
      pickup_scheduled_date: date,
      status: shipment.status === "created" ? "pickup_scheduled" : shipment.status,
      metadata: { ...(shipment.metadata ?? {}), pickup: { date, time: pickupTime, booked_at: new Date().toISOString() } },
    })
    if (shipment.status === "created") {
      try {
        const eventBus: any = container.resolve(Modules.EVENT_BUS)
        await eventBus.emit({
          name: INVENTORY_SHIPMENT_STATUS_CHANGED_EVENT,
          data: {
            id: shipment.id,
            awb: shipment.awb ?? null,
            carrier: shipment.carrier,
            previous_status: "created",
            status: "pickup_scheduled",
            order_id: input.orderId,
            pickup_scheduled_date: date,
          },
        })
      } catch {
        /* best-effort */
      }
    }
    return { scheduled: true, pickup_date: date, pickup_time: pickupTime, reason: null }
  } catch (e: any) {
    if (e instanceof MedusaError) throw e
    return { scheduled: false, pickup_date: null, pickup_time: null, reason: e?.message ? String(e.message) : "The carrier did not accept the pickup." }
  }
}
