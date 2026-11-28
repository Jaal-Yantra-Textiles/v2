/**
 * Carriers partners can pick for an inventory-order shipment, and how each one
 * is booked.
 *
 * - API carriers (Shiprocket, Delhivery, DTDC) are booked through their API
 *   the moment the partner presses "Book".
 * - MANUAL carriers (India Post, until its API is whitelisted) are booked by
 *   staff outside the system: the partner's request becomes a
 *   `booking_pending` shipment, an admin books it on the carrier's side and
 *   fills in the AWB + label PDF, and only then does the partner see them.
 */

/** Booked by staff; no carrier API is called. */
export const MANUAL_BOOKING_CARRIERS = ["india_post"] as const

/**
 * Carriers that take the ship-from address inline on every booking (no
 * pickup-warehouse registry). Their bookings must never touch Shiprocket's
 * pickup registry: every partner shares one Shiprocket account.
 */
export const INLINE_ORIGIN_CARRIERS = ["dtdc", "bluedart"] as const

/** What a partner may choose, in display order. */
export const PARTNER_SHIPMENT_CARRIERS = [
  { id: "shiprocket", label: "Shiprocket", booking: "api", rates: true, pickup: true },
  { id: "delhivery", label: "Delhivery", booking: "api", rates: false, pickup: true },
  { id: "dtdc", label: "DTDC", booking: "api", rates: false, pickup: false },
  { id: "india_post", label: "India Post", booking: "manual", rates: false, pickup: false },
] as const

const norm = (c?: string | null) => String(c || "").trim().toLowerCase()

export function isManualBookingCarrier(carrier?: string | null): boolean {
  return (MANUAL_BOOKING_CARRIERS as readonly string[]).includes(norm(carrier))
}

export function isInlineOriginCarrier(carrier?: string | null): boolean {
  return (INLINE_ORIGIN_CARRIERS as readonly string[]).includes(norm(carrier))
}
