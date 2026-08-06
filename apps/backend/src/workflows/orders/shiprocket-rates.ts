import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { resolveShippingProvider } from "../../modules/shipping-providers/resolver"
import { isInternationalDestination } from "../../modules/shipping-providers/destination"
import { SHIPROCKET_PICKUP_METADATA_KEY } from "../../modules/shipping-providers/pickup-locations"
import type {
  PickupLocation,
  RateOption,
} from "../../modules/shipping-providers/provider-interface"

/**
 * #641 — surface Shiprocket courier options (rate / ETA / recommended) for an
 * order so admin/partner can CHOOSE a courier before generating the label.
 * Wraps `ShiprocketClient.getRates` (`/courier/serviceability/`) using the
 * order's registered pickup pincode (origin) + the shipping address pincode
 * (destination) + a package weight. The chosen `courier_id` then threads into
 * `POST .../shiprocket-label` via `preferredCourierId`.
 */

const DEFAULT_WEIGHT_GRAMS = 500

/**
 * Pick which registered pickup to quote FROM. Prefer the pickup whose nickname
 * matches the order's fulfillment stock-location (so the quoted origin matches
 * where the label will actually ship from); otherwise fall back to the
 * shippable-first heuristic the label flow uses (#638). Pure — unit-tested.
 */
export function pickRatesPickup(
  pickups: PickupLocation[] | undefined | null,
  preferredName?: string | null
): PickupLocation | undefined {
  if (!pickups?.length) return undefined
  if (preferredName) {
    const match = pickups.find((p) => p.name === preferredName)
    if (match) return match
  }
  return pickups.find((p) => p.shippable) ?? pickups[0]
}

export type ShiprocketRatesInput = {
  orderId: string
  /** Defaults to "shiprocket". */
  carrier?: string
  weightGrams?: number
}

export type ShiprocketRatesResult = {
  origin_pincode: string
  destination_pincode: string
  weight_grams: number
  cod: boolean
  rates: RateOption[]
  /** Destination country (ISO-2). Present so the UI can label the quote. */
  destination_country?: string
  /** True when quoted through the carrier's cross-border product. */
  international?: boolean
}

export async function getShiprocketRatesForOrder(
  container: MedusaContainer,
  input: ShiprocketRatesInput
): Promise<ShiprocketRatesResult> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "metadata",
      "shipping_address.postal_code",
      "shipping_address.country_code",
      // Same fallback source the label flow walks (#1212): the postal code can
      // land on the billing address instead, and quoting must not fail on a
      // field the label call would have found.
      "billing_address.postal_code",
      "billing_address.country_code",
      "fulfillments.location_id",
    ],
    filters: { id: input.orderId },
  })
  const order = orders?.[0]
  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Order ${input.orderId} not found`
    )
  }

  const destinationPincode = String(
    order.shipping_address?.postal_code ||
      order.billing_address?.postal_code ||
      ""
  ).trim()
  const destinationCountry = String(
    order.shipping_address?.country_code ||
      order.billing_address?.country_code ||
      ""
  )
    .trim()
    .toUpperCase()
  const international = isInternationalDestination(destinationCountry)

  // A cross-border quote is priced on destination COUNTRY + weight, not on a
  // postcode, so a missing pincode must not block it — international couriers
  // quote fine without one (and the label flow validates it separately, where it
  // actually matters). Domestic serviceability genuinely needs the pincode.
  if (!destinationPincode && !international) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Order has no shipping-address pincode to quote a delivery rate against."
    )
  }

  // Preferred pickup nickname: the order's fulfillment stock-location Shiprocket
  // nickname, if any (mirrors the label flow's pickup resolution).
  let preferredNickname: string | undefined
  const locationId = (order.fulfillments || []).find(
    (f: any) => f?.location_id
  )?.location_id
  if (locationId) {
    const { data: locs } = await query.graph({
      entity: "stock_location",
      fields: ["id", "metadata"],
      filters: { id: locationId },
    })
    preferredNickname = (locs?.[0]?.metadata as any)?.[
      SHIPROCKET_PICKUP_METADATA_KEY
    ]
  }

  const carrier = input.carrier || "shiprocket"
  const provider = await resolveShippingProvider(container, carrier)
  if (!provider.getRates || !provider.listPickupLocations) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `${carrier} provider does not support rate quotes`
    )
  }

  const pickups = await provider.listPickupLocations()
  const pickup = pickRatesPickup(pickups, preferredNickname)
  const originPincode = String(pickup?.pincode || "").trim()
  if (!originPincode) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `No ${carrier} pickup location with a pincode is configured. Register a pickup location before requesting courier rates.`
    )
  }

  const cod = order.metadata?.payment_mode === "cod"
  const weightGrams = input.weightGrams || DEFAULT_WEIGHT_GRAMS

  // `destination_country` is what makes the adapter reach for its cross-border
  // product. Omitting it was why international orders came back with an empty
  // courier list: the quote went to the India-only pincode endpoint, which has
  // no couriers to offer for a foreign postcode and reports that as success.
  const rates = await provider.getRates({
    origin_pincode: originPincode,
    destination_pincode: destinationPincode,
    destination_country: destinationCountry || undefined,
    weight_grams: weightGrams,
    cod,
  })

  return {
    origin_pincode: originPincode,
    destination_pincode: destinationPincode,
    destination_country: destinationCountry || undefined,
    international,
    weight_grams: weightGrams,
    cod,
    rates,
  }
}
