/**
 * Pure selection of a partner's ship-from stock location (#772 core-order
 * half). A partner's locations are the ones linked to their store's default
 * sales channel; most partners have exactly one. When there are several,
 * prefer the one already registered as a Shiprocket pickup (metadata
 * nickname), then one with a registerable address (phone + pincode), then the
 * first — deterministic, so repeated label attempts ship from the same place.
 */

export type ShipFromCandidate = {
  id: string
  /** stock_location.metadata[shiprocket_pickup_location], when recorded. */
  pickup_nickname?: string | null
  phone?: string | null
  postal_code?: string | null
}

export function pickPartnerShipFromLocation(
  candidates: ShipFromCandidate[] | undefined | null
): ShipFromCandidate | null {
  const list = (candidates || []).filter((c) => c?.id)
  if (!list.length) return null
  const registered = list.find((c) => c.pickup_nickname)
  if (registered) return registered
  const registerable = list.find(
    (c) => String(c.phone || "").trim() && String(c.postal_code || "").trim()
  )
  return registerable ?? list[0]
}
