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
import { SHIPROCKET_PICKUP_METADATA_KEY } from "../../modules/shipping-providers/pickup-locations"

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
  metadata?: Record<string, any> | null
  shipping_address?: Record<string, any> | null
  items?: Array<{
    title?: string | null
    quantity?: number | null
    unit_price?: number | null
    sku?: string | null
  }> | null
}

export type BuildShipmentOpts = {
  pickupLocationName?: string
  weightGrams?: number
  dimensionsCm?: Dimensions
  preferredCourierId?: string | number
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
    preferred_courier_id: opts.preferredCourierId,
  }
}

export type CreateShiprocketShipmentInput = {
  orderId: string
  fulfillmentId: string
  pickupLocationName?: string
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
      "metadata",
      "shipping_address.*",
      "items.title",
      "items.quantity",
      "items.unit_price",
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

  // Pickup nickname: explicit → the fulfillment's stock-location Shiprocket
  // nickname → (client default).
  let pickupLocationName = input.pickupLocationName
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

  const provider = await resolveShippingProvider(container, "shiprocket")
  if (!provider.createShipment) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Shiprocket provider does not support shipment creation"
    )
  }

  const shipmentInput = buildCreateShipmentInput(order as OrderForShipment, {
    pickupLocationName,
    weightGrams: input.weightGrams,
    dimensionsCm: input.dimensionsCm,
    preferredCourierId: input.preferredCourierId,
  })
  const result = await provider.createShipment(shipmentInput)

  // Persist the carrier refs onto fulfillment.data (what label/tracking read).
  await fulfillmentModule.updateFulfillment(input.fulfillmentId, {
    data: {
      ...(fulfillment.data || {}),
      carrier: "shiprocket",
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
