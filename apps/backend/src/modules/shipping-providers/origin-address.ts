import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import type { ShipmentAddress } from "./provider-interface"

/**
 * The seller / ship-from address for a shipment, read off the fulfillment's
 * stock location.
 *
 * `CreateShipmentInput.from` has existed since the #31 provider spike and
 * NOTHING ever populated it — `buildCreateShipmentInput` simply never set the
 * field. That was invisible for the first two carriers, exactly as the interface
 * comment says: Shiprocket derives the origin from the registered
 * `pickup_location_name`, and Delhivery from the registered warehouse. Neither
 * reads `from`, so an empty one cost nothing.
 *
 * Blue Dart does read it. Its waybill carries the origin inline — `Shipper`
 * (address, pincode, mobile) and `Returnadds` — and with `from` undefined every
 * one of those fields went out as `""`. Blue Dart answers that with a bare 400
 * and an EMPTY body, which names nothing and reads like an auth or path fault.
 * On an export it matters twice over: the shipper address is on the customs
 * paperwork, not just the routing.
 *
 * Best-effort by design. A location we cannot read leaves `from` undefined,
 * which is exactly the behaviour every existing Shiprocket and Delhivery label
 * had — so this can only add information, never take a working label away.
 */
export async function resolveOriginAddress(
  container: MedusaContainer,
  locationId?: string | null
): Promise<ShipmentAddress | undefined> {
  if (!locationId) {
    return undefined
  }
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const { data: locs } = await query.graph({
      entity: "stock_location",
      fields: [
        "id",
        "name",
        "address.address_1",
        "address.address_2",
        "address.city",
        "address.province",
        "address.postal_code",
        "address.country_code",
        "address.phone",
        "address.company",
      ],
      filters: { id: locationId },
    })
    return originAddressFromLocation(locs?.[0])
  } catch (e: any) {
    logger?.warn?.(
      `[origin-address] could not read the ship-from address for location ${locationId}: ${e?.message}`
    )
    return undefined
  }
}

/**
 * Pure: a stock location → `ShipmentAddress`, or undefined when there is not
 * enough of one to be worth sending.
 *
 * The bar is a street line AND a pincode. A half-filled origin is worse than
 * none: Blue Dart validates the block as a unit, so sending a name with a blank
 * pincode fails the same 400 as sending nothing, while an absent `from` keeps
 * the carriers that derive their origin from a registered pickup working
 * exactly as before.
 *
 * `company` wins over the location's own name because the location name is
 * frequently the derived `warehouse-<last8>` handle (#1234), which is a routing
 * key rather than something a courier or a customs officer should read.
 */
export function originAddressFromLocation(
  location: any
): ShipmentAddress | undefined {
  const addr = location?.address
  if (!addr) {
    return undefined
  }
  const address_1 = String(addr.address_1 || "").trim()
  const pincode = String(addr.postal_code || "").trim()
  if (!address_1 || !pincode) {
    return undefined
  }
  return {
    name: String(addr.company || location?.name || "").trim(),
    phone: String(addr.phone || "").trim(),
    address_1,
    address_2: String(addr.address_2 || "").trim() || undefined,
    city: String(addr.city || "").trim(),
    state: String(addr.province || "").trim(),
    pincode,
    country: String(addr.country_code || "IN").toUpperCase(),
  }
}
