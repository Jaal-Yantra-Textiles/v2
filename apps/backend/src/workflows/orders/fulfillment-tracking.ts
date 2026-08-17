import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import {
  isSupportedCarrier,
  resolveShippingProvider,
  shipmentRefFromFulfillment,
} from "../../modules/shipping-providers/resolver"

/**
 * Live carrier tracking for one fulfillment — the shared body behind both the
 * partner and the admin tracking routes.
 *
 * WHY THIS IS SHARED RATHER THAN COPIED
 * -------------------------------------
 * The capability has existed in the adapters for a while (Blue Dart's `track()`
 * even prefers DHL Unified Shipment Tracking, because Blue Dart's own TnT drops
 * cancelled waybills and answers `"Incorrect waybill number or No information"`
 * — indistinguishable from a typo). But the ONLY route that called it was the
 * partner one, so for an in-house order like #83 nobody could ask "has the
 * carrier collected it?" from inside this system at all. That question then got
 * answered by waiting.
 *
 * The half worth not duplicating is the FALLBACK: when there is no carrier
 * client, the answer is still a timeline, synthesised from the fulfillment's own
 * timestamps. Two copies of that would drift, and the drift would be invisible
 * — both would keep returning a plausible-looking timeline.
 */

export type TrackingEvent = {
  timestamp: string
  status: string
  location: string
  scan_type: string
}

export type FulfillmentTracking = {
  waybill: string
  carrier: string
  current_status: string
  current_status_type: string
  estimated_delivery: string | null
  origin: string
  destination: string
  events: TrackingEvent[]
  /**
   * Whether these events came from the carrier or were synthesised locally.
   *
   * Returned because the two answer different questions and look identical: a
   * local timeline can say "Awaiting Shipping" for a parcel the carrier picked
   * up an hour ago. An operator deciding whether to chase a pickup needs to know
   * which one they are reading.
   */
  source: "carrier" | "fulfillment"
}

/**
 * PURE: the timeline a fulfillment's own timestamps imply, for carriers we
 * cannot call. Exported for unit testing.
 */
export function timelineFromFulfillment(fulfillment: {
  created_at?: string | null
  shipped_at?: string | null
  delivered_at?: string | null
  canceled_at?: string | null
}): TrackingEvent[] {
  const stamps: Array<[string | null | undefined, string, string]> = [
    [fulfillment.created_at, "Fulfillment created", "created"],
    [fulfillment.shipped_at, "Shipped", "shipped"],
    [fulfillment.delivered_at, "Delivered", "delivered"],
    [fulfillment.canceled_at, "Canceled", "canceled"],
  ]

  return stamps
    .filter(([at]) => !!at)
    .map(([at, status, scan_type]) => ({
      timestamp: String(at),
      status,
      location: "",
      scan_type,
    }))
    .sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
}

/**
 * PURE: the status a fulfillment's own timestamps imply. Exported for testing.
 *
 * ⚠️ This is what we know, NOT what the parcel is doing. "Awaiting Shipping"
 * here means nobody has marked it shipped in this system — it is not a claim
 * that the carrier has not collected it.
 */
export function statusFromFulfillment(fulfillment: {
  shipped_at?: string | null
  delivered_at?: string | null
  canceled_at?: string | null
}): string {
  if (fulfillment.canceled_at) return "Canceled"
  if (fulfillment.delivered_at) return "Delivered"
  if (fulfillment.shipped_at) return "Shipped"
  return "Awaiting Shipping"
}

/**
 * Track a fulfillment, preferring the carrier and falling back to local state.
 *
 * Throws NOT_FOUND when the fulfillment or its waybill is missing — without a
 * waybill there is nothing to ask about, and an empty timeline would read as
 * "no movement" rather than "never booked".
 */
export async function getFulfillmentTracking(
  container: MedusaContainer,
  orderId: string,
  fulfillmentId: string
): Promise<FulfillmentTracking> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  const { data: orders } = await query.graph({
    entity: "orders",
    fields: ["id", "fulfillments.*", "fulfillments.labels.*"],
    filters: { id: orderId },
  })

  const order = (orders as any)?.[0]
  const fulfillment = order?.fulfillments?.find(
    (f: any) => f.id === fulfillmentId
  )

  if (!fulfillment) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Fulfillment not found")
  }

  const waybill =
    fulfillment.data?.waybill ||
    fulfillment.data?.tracking_number ||
    fulfillment.labels?.[0]?.tracking_number

  if (!waybill) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No waybill found for this fulfillment"
    )
  }

  const carrier = fulfillment.data?.carrier

  if (isSupportedCarrier(carrier)) {
    try {
      const provider = await resolveShippingProvider(container, carrier)
      const result = await provider.track(
        shipmentRefFromFulfillment(fulfillment.data)
      )

      return {
        waybill: result.awb || waybill,
        carrier: result.carrier,
        current_status: result.current_status,
        // Carriers disagree on the shape of a status code — Blue Dart answers
        // with a string, Delhivery with a number — so it is normalised here
        // rather than leaking the union to every caller.
        current_status_type:
          result.current_status_code == null
            ? ""
            : String(result.current_status_code),
        estimated_delivery: result.estimated_delivery ?? null,
        origin: result.origin || "",
        destination: result.destination || "",
        events: result.events,
        source: "carrier",
      }
    } catch (e: any) {
      // A carrier that cannot answer must not take the whole route down: the
      // local timeline is still worth having, and a 500 here would read to the
      // operator as "tracking is broken" rather than "the carrier said no".
      logger?.warn?.(
        `[fulfillment-tracking] ${carrier} tracking failed for ${waybill}: ${e?.message}. Falling back to local state.`
      )
    }
  }

  return {
    waybill,
    carrier: carrier || "unknown",
    current_status: statusFromFulfillment(fulfillment),
    current_status_type: "",
    estimated_delivery: null,
    origin: "",
    destination: "",
    events: timelineFromFulfillment(fulfillment),
    source: "fulfillment",
  }
}
