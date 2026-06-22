/**
 * Shiprocket pickup-location registration (#31, SHIPPING_PROVIDERS.md §9).
 *
 * Resolver-driven, mirrors how Delhivery warehouses are wired but sources creds
 * from the external-platform store via `resolveShippingProvider` rather than the
 * fulfillment-module registry + env vars.
 *
 * A Shiprocket pickup point is referenced by a unique nickname string
 * (`pickup_location`), not by address. We use a deterministic nickname per stock
 * location (`warehouse-<locationSuffix>`, the same scheme as Delhivery) so the
 * mapping survives re-runs, then record it on `stock_location.metadata`.
 *
 * Registration is idempotent: we list existing pickups first and treat an
 * already-present nickname as success. Note "registered" ≠ "shippable" —
 * Shiprocket requires the pickup phone to be OTP-verified before live pickups,
 * so callers surface `phone_verified` (per §9.3, only on demand).
 */
import { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PickupLocation } from "./provider-interface"
import { resolveShippingProvider } from "./resolver"

/** Metadata key recording the Shiprocket nickname for a stock location. */
export const SHIPROCKET_PICKUP_METADATA_KEY = "shiprocket_pickup_location"

/**
 * Deterministic pickup nickname for a stock location. Same scheme as the
 * Delhivery warehouse name (`warehouse-<last 8 of locationId>`) so a location
 * that already carries a Delhivery warehouse maps to a matching Shiprocket
 * nickname.
 */
export function pickupNicknameForLocation(locationId: string): string {
  return `warehouse-${locationId.slice(-8)}`
}

/**
 * Choose which registered Shiprocket pickup to ship from when a fulfillment's
 * stock location carries no nickname. Prefer a shippable pickup; otherwise fall
 * back to the first registered one. Returns undefined when there are none.
 * Pure — unit-tested. (#638)
 */
export function chooseRegisteredPickup(
  pickups: PickupLocation[] | undefined | null
): PickupLocation | undefined {
  if (!pickups?.length) return undefined
  return pickups.find((p) => p.shippable) ?? pickups[0]
}

export type PickupRegistrationResult = {
  /** The nickname now recorded on the stock location. */
  name: string
  /** True when the nickname already existed in Shiprocket (no add performed). */
  already_existed: boolean
  /** Whether the pickup is usable for live pickups (source of truth for UI). */
  shippable?: boolean
  /** Phone-OTP status from the carrier list, when known (informational only). */
  phone_verified?: boolean
  /** The matched/created carrier-side pickup record, when available. */
  location?: PickupLocation
}

type StockLocationRow = {
  id: string
  name?: string
  metadata?: Record<string, any> | null
  address?: {
    phone?: string
    address_1?: string
    address_2?: string
    city?: string
    province?: string
    postal_code?: string
    country_code?: string
  } | null
}

async function loadStockLocation(
  container: MedusaContainer,
  locationId: string
): Promise<StockLocationRow> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name", "metadata", "address.*"],
    filters: { id: locationId },
  })
  const loc = (data as any)?.[0]
  if (!loc) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Stock location ${locationId} not found`
    )
  }
  return loc as StockLocationRow
}

/**
 * Register (or confirm) a stock location as a Shiprocket pickup point and record
 * the nickname on `stock_location.metadata`. Idempotent — safe to re-run.
 *
 * Used by the admin on-demand action (opt-in / inbound auto-register) and the
 * backfill script. `opts.email` is the contact email recorded on the pickup
 * (the admin route passes the acting user's email). Shiprocket REQUIRES a
 * non-empty email on addpickup (it 422s otherwise, #427); when no email is
 * given the client falls back to the Shiprocket account email.
 */
export async function registerShiprocketPickup(
  container: MedusaContainer,
  locationId: string,
  opts?: { email?: string }
): Promise<PickupRegistrationResult> {
  const loc = await loadStockLocation(container, locationId)
  const existingNickname = (loc.metadata as any)?.[
    SHIPROCKET_PICKUP_METADATA_KEY
  ] as string | undefined
  const nickname = existingNickname || pickupNicknameForLocation(locationId)

  const provider = await resolveShippingProvider(container, "shiprocket")
  if (!provider.registerPickupLocation) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Shiprocket provider does not support pickup-location registration"
    )
  }

  // Idempotency: skip the add if the nickname already exists carrier-side.
  let existing: PickupLocation | undefined
  if (provider.listPickupLocations) {
    try {
      const list = await provider.listPickupLocations()
      existing = list.find((p) => p.name === nickname)
    } catch {
      // List failing shouldn't block a register attempt; addpickup itself
      // rejects duplicate nicknames, which we treat as success below.
    }
  }

  let alreadyExisted = Boolean(existing)
  // A freshly-added pickup isn't in the list we just fetched; derive whether it
  // ships from the address we register it with (#435 — a complete address makes
  // an API pickup shippable without the phone-OTP step).
  let addedShippable: boolean | undefined
  if (!existing) {
    const addr = loc.address || {}
    if (!addr.phone || !addr.postal_code) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Stock location ${locationId} is missing a phone or postal code required to register a Shiprocket pickup`
      )
    }
    addedShippable =
      Boolean(addr.address_1 && addr.city && addr.postal_code && addr.phone) ||
      undefined
    try {
      await provider.registerPickupLocation({
        // Pass the acting user's email when known; the client falls back to the
        // Shiprocket account email so the required `email` is never empty (#427).
        name: nickname,
        phone: addr.phone,
        email: opts?.email,
        address_1: addr.address_1 || "",
        address_2: addr.address_2 || "",
        city: addr.city || "",
        state: addr.province || "",
        pincode: addr.postal_code,
        country: "India",
      })
    } catch (e: any) {
      // Shiprocket rejects a duplicate nickname — treat that as already-present.
      if (/already|exist|duplicate/i.test(String(e?.message || ""))) {
        alreadyExisted = true
      } else {
        throw e
      }
    }
  }

  // Record the nickname on the stock location (preserve other metadata).
  await persistNickname(container, loc, nickname)

  return {
    name: nickname,
    already_existed: alreadyExisted,
    shippable: existing ? existing.shippable : addedShippable,
    phone_verified: existing?.phone_verified,
    location: existing,
  }
}

/** Persist the Shiprocket nickname onto a stock location's metadata. */
async function persistNickname(
  container: MedusaContainer,
  loc: StockLocationRow,
  nickname: string
): Promise<void> {
  if ((loc.metadata as any)?.[SHIPROCKET_PICKUP_METADATA_KEY] === nickname) {
    return
  }
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION) as any
  await stockLocationService.updateStockLocations(loc.id, {
    metadata: {
      ...(loc.metadata || {}),
      [SHIPROCKET_PICKUP_METADATA_KEY]: nickname,
    },
  })
}

/**
 * Map an already-recorded nickname for a stock location onto its live carrier
 * status. Returns null when the location has no nickname recorded. Used by the
 * admin GET (default-hidden status) — no registration side effects.
 */
export async function getShiprocketPickupStatus(
  container: MedusaContainer,
  locationId: string
): Promise<PickupRegistrationResult | null> {
  const loc = await loadStockLocation(container, locationId)
  const nickname = (loc.metadata as any)?.[SHIPROCKET_PICKUP_METADATA_KEY] as
    | string
    | undefined
  if (!nickname) return null

  const provider = await resolveShippingProvider(container, "shiprocket")
  let existing: PickupLocation | undefined
  if (provider.listPickupLocations) {
    const list = await provider.listPickupLocations()
    existing = list.find((p) => p.name === nickname)
  }
  return {
    name: nickname,
    already_existed: Boolean(existing),
    shippable: existing?.shippable,
    phone_verified: existing?.phone_verified,
    location: existing,
  }
}
