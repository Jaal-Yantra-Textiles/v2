/**
 * The deterministic Delhivery warehouse name for a stock location.
 *
 * Deliberately dependency-free: it is imported both by the fulfillment PROVIDER
 * (which runs inside the fulfillment module and cannot resolve the stock-location
 * module) and by the registration helper (which can). Because both sides derive
 * the name from the location id alone, they agree without sharing a lookup.
 *
 * That agreement is the whole point. Delhivery requires the `pickup_location`
 * sent on order creation to match a registered warehouse EXACTLY and
 * CASE-SENSITIVELY, and warehouse names must be unique across the account — so
 * a stable, lowercase, per-location name satisfies all three at once.
 *
 * The scheme matches `pickupNicknameForLocation` in `../pickup-locations.ts`, so
 * a location registered with both carriers carries the same nickname on each.
 */
export function delhiveryWarehouseNameForLocation(
  locationId?: string | null
): string | undefined {
  const id = String(locationId || "").trim()
  if (!id) return undefined
  return `warehouse-${id.slice(-8)}`
}

/** Metadata key recording the Delhivery warehouse name for a stock location. */
export const DELHIVERY_WAREHOUSE_METADATA_KEY = "delhivery_warehouse_name"
