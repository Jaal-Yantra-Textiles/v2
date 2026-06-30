import { MedusaError } from "@medusajs/framework/utils"

/**
 * #790 slice 2 — guard for when a standalone carrier shipment may be created for
 * an inventory order. Pure (no container) so it's unit-testable directly.
 *
 * Allowed from the "goods exist / ready to move" states:
 *   - "Ready for Delivery" — the intended trigger (packed, ready for the carrier),
 *   - "Processing" / "Partial" — backward-compat with the pre-#790 flow where a
 *     shipment could be generated straight off a (partial) completion,
 *   - "Shipped" — re-attempt after a transient carrier failure.
 *
 * Rejected for "Pending" (nothing produced yet), "Delivered" (already received),
 * and "Cancelled" (dead order) with INVALID_DATA.
 */
const SHIPPABLE_STATUSES = new Set([
  "Processing",
  "Ready for Delivery",
  "Partial",
  "Shipped",
])

export const isShipmentAllowed = (status: string | null | undefined): boolean =>
  SHIPPABLE_STATUSES.has(String(status ?? ""))

export const assertShipmentAllowed = (status: string | null | undefined): void => {
  if (!isShipmentAllowed(status)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Cannot create a shipment for an inventory order in status '${status ?? "unknown"}'. Mark it "Ready for Delivery" first.`
    )
  }
}
