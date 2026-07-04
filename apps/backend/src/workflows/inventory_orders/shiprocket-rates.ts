import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { resolveShippingProvider } from "../../modules/shipping-providers/resolver"
import { SHIPROCKET_PICKUP_METADATA_KEY } from "../../modules/shipping-providers/pickup-locations"
import type {
  Dimensions,
  RateOption,
} from "../../modules/shipping-providers/provider-interface"
import InventoryOrdersStockLocationsLink from "../../links/inventory-orders-stock-locations"
import {
  DEFAULT_INVENTORY_SHIPMENT_WEIGHT_GRAMS,
  normalizeDimensionsCm,
  resolveInventoryDestinationAddress,
} from "./lib/inventory-order-shipment"

/**
 * Inventory-order analogue of `getShiprocketRatesForOrder` (#641) — surface the
 * Shiprocket courier options (rate / ETA / recommended) for a stock-movement
 * shipment so admin/partner can CHOOSE a courier before generating the label,
 * instead of Shiprocket auto-assigning one.
 *
 * Origin = the order's `from_location` (mirrors the shipment flow's pickup
 * resolution, 740a2b240): the location's recorded pickup nickname → that
 * registered pickup's pincode, else the location's own address pincode (what
 * an on-the-fly registration would use). There is deliberately NO
 * any-registered-pickup fallback — all parties share one Shiprocket account,
 * so "first shippable pickup" is some OTHER party's warehouse and the quote
 * would disagree with the real shipment origin. Destination = the
 * `to_location`'s pincode (the same structured address the shipment ships to,
 * #864/#772). The chosen `courier_id` then threads into the shipment via
 * `preferredCourierId`.
 */

export type InventoryOrderRatesInput = {
  orderId: string
  /**
   * Explicit ship-from override (mirrors the shipment input's
   * `pickupStockLocationId`) so the quote matches a pickup the operator picked
   * in the modal — e.g. when the order's linked from_location was deleted.
   */
  pickupStockLocationId?: string
  weightGrams?: number
  dimensionsCm?: Dimensions | { length?: number; breadth?: number; height?: number }
}

export type InventoryOrderRatesResult = {
  origin_pincode: string
  destination_pincode: string
  weight_grams: number
  cod: boolean
  rates: RateOption[]
}

export async function getShiprocketRatesForInventoryOrder(
  container: MedusaContainer,
  input: InventoryOrderRatesInput
): Promise<InventoryOrderRatesResult> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: "inventory_orders",
    fields: ["id", "metadata", "shipping_address"],
    filters: { id: input.orderId },
  })
  const order = orders?.[0]
  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order ${input.orderId} not found`
    )
  }

  // to/from stock-location links (extraColumns to_location/from_location).
  const { data: links } = await query.graph({
    entity: (InventoryOrdersStockLocationsLink as any).entryPoint,
    fields: [
      "to_location",
      "from_location",
      "stock_location.name",
      "stock_location.metadata",
      "stock_location.address.*",
    ],
    filters: { inventory_orders_id: order.id },
  })
  const toLocation = (links || []).find((l: any) => l?.to_location)?.stock_location || null
  let fromLocation =
    (links || []).find((l: any) => l?.from_location)?.stock_location || null

  // Explicit ship-from override wins over the linked from_location (same
  // precedence as the shipment flow), so the quoted origin matches the pickup
  // the operator actually selected.
  if (input.pickupStockLocationId) {
    const { data: locs } = await query.graph({
      entity: "stock_location",
      fields: ["id", "name", "metadata", "address.*"],
      filters: { id: input.pickupStockLocationId },
    })
    fromLocation = locs?.[0] || fromLocation
  }

  // Destination pincode: the to-location address (explicit shipping_address wins).
  const destinationAddress = resolveInventoryDestinationAddress(
    (order as any)?.shipping_address,
    toLocation?.address,
    toLocation?.name
  )
  const destinationPincode = String(destinationAddress.postal_code || "").trim()
  if (!destinationPincode) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Order has no destination pincode to quote a delivery rate against. Set a complete address on the destination stock location."
    )
  }

  const provider = await resolveShippingProvider(container, "shiprocket")
  if (!provider.getRates) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Shiprocket provider does not support rate quotes"
    )
  }

  // Origin pincode: the order's from_location, never another warehouse. A
  // recorded pickup nickname resolves to THAT registered pickup's pincode
  // (exact match only); otherwise the location's own address pincode — the
  // same one an on-the-fly pickup registration would use at shipment time.
  const fromNickname = (fromLocation?.metadata as any)?.[
    SHIPROCKET_PICKUP_METADATA_KEY
  ] as string | undefined
  let originPincode = ""
  if (fromNickname && provider.listPickupLocations) {
    const pickups = await provider.listPickupLocations()
    const match = (pickups || []).find((p) => p.name === fromNickname)
    originPincode = String(match?.pincode || "").trim()
  }
  if (!originPincode) {
    originPincode = String(
      (fromLocation?.address as any)?.postal_code || ""
    ).trim()
  }
  if (!originPincode) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `The order's source location ${
        fromLocation?.name ? `"${fromLocation.name}" ` : ""
      }has no pincode to quote pickup rates from. Set a complete address on the source stock location (or register it as a Shiprocket pickup), then retry.`
    )
  }

  const cod = (order as any).metadata?.payment_mode === "cod"
  const weightGrams = input.weightGrams || DEFAULT_INVENTORY_SHIPMENT_WEIGHT_GRAMS
  const dimensions_cm = normalizeDimensionsCm(input.dimensionsCm as any)

  const rates = await provider.getRates({
    origin_pincode: originPincode,
    destination_pincode: destinationPincode,
    weight_grams: weightGrams,
    cod,
    dimensions_cm,
  })

  return {
    origin_pincode: originPincode,
    destination_pincode: destinationPincode,
    weight_grams: weightGrams,
    cod,
    rates,
  }
}
