import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { resolveShippingProvider } from "../../modules/shipping-providers/resolver"
import type {
  CreateShipmentInput,
  Dimensions,
  ShipmentItem,
  ShipmentResult,
} from "../../modules/shipping-providers/provider-interface"
import {
  SHIPROCKET_PICKUP_METADATA_KEY,
  chooseRegisteredPickup,
  registerShiprocketPickup,
} from "../../modules/shipping-providers/pickup-locations"
import { resolveSellerTaxIdForOrder } from "../../modules/shipping-providers/seller-tax-id"

/**
 * #404 (#31) PR-B — generate a Shiprocket shipment (forward order → AWB → label)
 * for a fulfillment of a (converted) order, and persist the carrier refs onto
 * `fulfillment.data` so the existing label/tracking/pickup routes can read them.
 *
 * The admin creates the fulfillment first via Medusa core's
 * `POST /admin/orders/:id/fulfillments`; this drives the carrier off it — the
 * first consumer of `ShippingProviderClient.createShipment` (the label/tracking
 * routes only ever fetched against an already-populated `fulfillment.data`).
 */

const DEFAULT_WEIGHT_GRAMS = 500

export type OrderForShipment = {
  id: string
  email?: string | null
  total?: number | null
  subtotal?: number | null
  /** ISO-4217 currency the order was placed in — declared value for intl customs (#1111). */
  currency_code?: string | null
  metadata?: Record<string, any> | null
  shipping_address?: Record<string, any> | null
  items?: Array<{
    title?: string | null
    quantity?: number | null
    unit_price?: number | null
    sku?: string | null
    /** Product variant behind the line — carries the customs `hs_code` (#1111). */
    variant?: { hs_code?: string | null } | null
    /** HSN/HS-code fallback for ad-hoc (variant-less) lines. */
    metadata?: Record<string, any> | null
  }> | null
}

export type BuildShipmentOpts = {
  pickupLocationName?: string
  weightGrams?: number
  dimensionsCm?: Dimensions
  preferredCourierId?: string | number
  /** Seller tax/GST ID to stamp on the label (#348); resolved by the caller. */
  taxId?: string
}

/**
 * Pure mapping from a core order onto a `CreateShipmentInput`. COD orders
 * (metadata.payment_mode === "cod") carry a `cod_amount` (the order total in
 * major units); prepaid orders don't. Exported for unit testing.
 */
export function buildCreateShipmentInput(
  order: OrderForShipment,
  opts: BuildShipmentOpts
): CreateShipmentInput {
  const addr = order.shipping_address || {}
  const paymentMode: "prepaid" | "cod" =
    order.metadata?.payment_mode === "cod" ? "cod" : "prepaid"

  const items: ShipmentItem[] = (order.items || []).map((li) => ({
    name: li.title || "Item",
    sku: li.sku || undefined,
    quantity: Number(li.quantity) || 1,
    unit_price: Number(li.unit_price) || 0,
    // HSN for international customs (#1111): prefer the variant's hs_code, then
    // line metadata (for ad-hoc, variant-less lines). Domestic shipments ignore
    // it; the client requires it only when the destination is international.
    hsn: (li.variant?.hs_code || li.metadata?.hsn || undefined) as string | undefined,
  }))
  const subTotal =
    order.subtotal != null
      ? Number(order.subtotal)
      : items.reduce((s, i) => s + i.unit_price * i.quantity, 0)

  const name =
    [addr.first_name, addr.last_name].filter(Boolean).join(" ") || "Customer"

  return {
    reference_id: order.id,
    payment_mode: paymentMode,
    cod_amount:
      paymentMode === "cod" ? Number(order.total) || subTotal : undefined,
    // "" lets the client fall back to its configured default pickup location.
    pickup_location_name: opts.pickupLocationName || "",
    to: {
      name,
      phone: addr.phone || "",
      email: order.email || addr.email || undefined,
      address_1: addr.address_1 || "",
      address_2: addr.address_2 || undefined,
      city: addr.city || "",
      state: addr.province || "",
      pincode: addr.postal_code || "",
      country: addr.country_code ? String(addr.country_code).toUpperCase() : "IN",
    },
    items,
    weight_grams: opts.weightGrams || DEFAULT_WEIGHT_GRAMS,
    dimensions_cm: opts.dimensionsCm,
    sub_total: subTotal,
    // Declared-value currency for international customs (#1111). Shiprocket reads
    // intl amounts in this currency; domestic ignores it.
    currency: order.currency_code ? String(order.currency_code).toUpperCase() : undefined,
    preferred_courier_id: opts.preferredCourierId,
    tax_id: opts.taxId,
  }
}

export type CreateShiprocketShipmentInput = {
  orderId: string
  fulfillmentId: string
  /** Defaults to "shiprocket". */
  carrier?: string
  pickupLocationName?: string
  /**
   * Explicit ship-from stock location (#772 core-order half — partner label
   * flow). Registered/confirmed as a carrier pickup on the fly (idempotent);
   * when set, the any-registered-pickup fallback below is NEVER used — a
   * partner's label must not ship from another party's warehouse on the
   * shared Shiprocket account.
   */
  pickupStockLocationId?: string
  /** Acting user's email recorded on a freshly-registered pickup (#427). */
  actingEmail?: string
  weightGrams?: number
  dimensionsCm?: Dimensions
  preferredCourierId?: string | number
}

export async function createShiprocketShipmentForFulfillment(
  container: MedusaContainer,
  input: CreateShiprocketShipmentInput
): Promise<ShipmentResult & { fulfillment_id: string }> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModule: any = container.resolve(Modules.FULFILLMENT)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "email",
      "total",
      "subtotal",
      "currency_code",
      "metadata",
      "shipping_address.*",
      "items.title",
      "items.quantity",
      "items.unit_price",
      "items.metadata",
      "items.variant.hs_code",
      "fulfillments.id",
      "fulfillments.location_id",
      "fulfillments.data",
    ],
    filters: { id: input.orderId },
  })
  const order = orders?.[0]
  if (!order) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${input.orderId} not found`)
  }
  const fulfillment = (order.fulfillments || []).find(
    (f: any) => f.id === input.fulfillmentId
  )
  if (!fulfillment) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Fulfillment ${input.fulfillmentId} not found on order ${input.orderId}`
    )
  }

  // Pickup nickname: explicit name → explicit ship-from stock location
  // (registered on the fly, no fallback past it) → the fulfillment's
  // stock-location Shiprocket nickname → (registered-pickup fallback, #638).
  let pickupLocationName = input.pickupLocationName
  if (!pickupLocationName && input.pickupStockLocationId) {
    try {
      const reg = await registerShiprocketPickup(
        container,
        input.pickupStockLocationId,
        { email: input.actingEmail }
      )
      pickupLocationName = reg.name
    } catch (e: any) {
      // A clean 400 with the reason — never a silent wrong-origin shipment.
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `The ship-from location ${input.pickupStockLocationId} could not be used as a carrier pickup: ${e?.message}`
      )
    }
  }
  if (!pickupLocationName && fulfillment.location_id) {
    const { data: locs } = await query.graph({
      entity: "stock_location",
      fields: ["id", "metadata"],
      filters: { id: fulfillment.location_id },
    })
    pickupLocationName = (locs?.[0]?.metadata as any)?.[
      SHIPROCKET_PICKUP_METADATA_KEY
    ]
  }

  const carrier = input.carrier || "shiprocket"
  const provider = await resolveShippingProvider(container, carrier)
  if (!provider.createShipment) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `${carrier} provider does not support shipment creation`
    )
  }

  // Fallback: when neither an explicit name nor the fulfillment's stock-location
  // nickname resolves a pickup, ship from a registered Shiprocket pickup (prefer
  // a shippable one). This is what makes Generate-Label work for converted
  // design orders whose fulfillment landed on a non-registered stock location.
  // (#638) — ADMIN flows only: an explicit pickupStockLocationId (partner label
  // flow) must never fall through to another party's warehouse.
  if (
    !pickupLocationName &&
    !input.pickupStockLocationId &&
    provider.listPickupLocations
  ) {
    try {
      const registered = await provider.listPickupLocations()
      pickupLocationName = chooseRegisteredPickup(registered)?.name
    } catch {
      // Listing is best-effort; the guard below produces the actionable error.
    }
  }

  if (!pickupLocationName) {
    // A clean MedusaError (not a raw 500) so the UI shows an actionable toast. (#638)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `No ${carrier} pickup location is configured. Register a pickup location for the order's stock location (or any ${carrier} pickup) before generating a label.`
    )
  }

  // Seller tax/GST ID (#348): partner-own → platform-by-country fallback.
  const taxId = await resolveSellerTaxIdForOrder(
    container,
    order.id,
    (order as any)?.shipping_address?.country_code
  )

  const shipmentInput = buildCreateShipmentInput(order as OrderForShipment, {
    pickupLocationName,
    weightGrams: input.weightGrams,
    dimensionsCm: input.dimensionsCm,
    preferredCourierId: input.preferredCourierId,
    taxId,
  })
  const result = await provider.createShipment(shipmentInput)

  // Persist the carrier refs onto fulfillment.data (what label/tracking read).
  await fulfillmentModule.updateFulfillment(input.fulfillmentId, {
    data: {
      ...(fulfillment.data || {}),
      carrier,
      waybill: result.awb,
      tracking_number: result.tracking_number,
      tracking_url: result.tracking_url,
      label_url: result.label_url,
      shipment_id: result.provider_refs?.shipment_id,
      sr_order_id: result.provider_refs?.sr_order_id,
      provider_refs: result.provider_refs,
    },
  })

  return { ...result, fulfillment_id: input.fulfillmentId }
}
