/**
 * Carrier-agnostic "make sure this location is a usable pickup" helper.
 *
 * Every carrier refuses a shipment from an unregistered origin, but each has its
 * own registration call and its own metadata key, and callers kept hardcoding
 * Shiprocket's. `create-production-run-transfer.ts` did exactly that: it called
 * `registerShiprocketPickup` no matter which carrier the caller asked for, so a
 * transfer booked with `carrier: "delhivery"` handed Delhivery a SHIPROCKET
 * nickname it had never seen — the same failure as order #83, on a second
 * surface.
 *
 * Dispatching on the carrier in use is the fix, and keeps the next carrier a
 * one-entry change rather than another hardcoded branch.
 */
import { MedusaContainer } from "@medusajs/framework/types"

import {
  SHIPROCKET_PICKUP_METADATA_KEY,
  registerShiprocketPickup,
} from "./pickup-locations"
import {
  DELHIVERY_WAREHOUSE_METADATA_KEY,
  registerDelhiveryWarehouse,
} from "./delhivery-warehouses"

/** The `stock_location.metadata` key holding a carrier's pickup name. */
export function carrierPickupMetadataKey(carrier: string): string | undefined {
  if (carrier === "shiprocket") return SHIPROCKET_PICKUP_METADATA_KEY
  if (carrier === "delhivery") return DELHIVERY_WAREHOUSE_METADATA_KEY
  return undefined
}

/**
 * The registered pickup name to ship this location's goods from, registering it
 * with the carrier on the fly when it has none. Idempotent.
 *
 * There is deliberately NO any-registered-pickup fallback: every party shares
 * one carrier account, so "first registered pickup" is someone else's warehouse.
 */
export async function ensureCarrierPickup(
  container: MedusaContainer,
  carrier: string,
  locationId: string,
  opts?: { email?: string; metadata?: Record<string, any> | null }
): Promise<string> {
  const key = carrierPickupMetadataKey(carrier)
  const recorded = key
    ? ((opts?.metadata as any)?.[key] as string | undefined)
    : undefined
  if (recorded) return recorded

  if (carrier === "delhivery") {
    const reg = await registerDelhiveryWarehouse(container, locationId, {
      email: opts?.email,
    })
    return reg.name
  }

  const reg = await registerShiprocketPickup(container, locationId, {
    email: opts?.email,
  })
  return reg.name
}
