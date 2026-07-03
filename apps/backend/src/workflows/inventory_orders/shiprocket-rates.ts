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
import { pickRatesPickup } from "../orders/shiprocket-rates"
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
 * Origin = the registered pickup for the order's `from_location` (mirrors the
 * shipment flow's pickup resolution). Destination = the `to_location`'s pincode
 * (the same structured address the shipment ships to, #864/#772). The chosen
 * `courier_id` then threads into the shipment via `preferredCourierId`.
 */

export type InventoryOrderRatesInput = {
  orderId: string
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
  const fromLocation = (links || []).find((l: any) => l?.from_location)?.stock_location || null

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
  if (!provider.getRates || !provider.listPickupLocations) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Shiprocket provider does not support rate quotes"
    )
  }

  // Origin pincode: the registered pickup matching the from-location's nickname,
  // else the shippable-first pickup (same heuristic the shipment flow uses).
  const fromNickname = (fromLocation?.metadata as any)?.[
    SHIPROCKET_PICKUP_METADATA_KEY
  ]
  const pickups = await provider.listPickupLocations()
  const pickup = pickRatesPickup(pickups, fromNickname)
  const originPincode = String(pickup?.pincode || "").trim()
  if (!originPincode) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No Shiprocket pickup location with a pincode is configured. Register a pickup for the source stock location before requesting courier rates."
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
