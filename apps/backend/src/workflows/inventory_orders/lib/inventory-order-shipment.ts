import type {
  CreateShipmentInput,
  Dimensions,
  ShipmentItem,
} from "../../../modules/shipping-providers/provider-interface"

/**
 * Pure mapping from an inventory order onto a carrier `CreateShipmentInput`
 * (#772). The inventory-order analogue of `buildCreateShipmentInput`
 * (workflows/orders/shiprocket-shipment.ts) for the partner stock-movement
 * shipment created on completion.
 *
 * Address semantics: `to` = the inventory order's `shipping_address`
 * (destination warehouse). The ship-from / pickup is a registered carrier
 * pickup referenced by `opts.pickupLocationName` (Shiprocket derives the origin
 * address from it), resolved + auto-registered by the caller. COD vs prepaid
 * follows `metadata.payment_mode` (stock movement is prepaid unless flagged).
 *
 * Pure & exported for unit testing.
 */

export const DEFAULT_INVENTORY_SHIPMENT_WEIGHT_GRAMS = 500

export type InventoryOrderLineForShipment = {
  id?: string | null
  quantity?: number | null
  price?: number | null
  metadata?: Record<string, any> | null
}

export type InventoryOrderForShipment = {
  id: string
  total_price?: number | null
  metadata?: Record<string, any> | null
  shipping_address?: Record<string, any> | null
  orderlines?: InventoryOrderLineForShipment[] | null
}

export type BuildInventoryShipmentOpts = {
  /** Registered carrier pickup nickname (exact match). "" → client default. */
  pickupLocationName?: string
  weightGrams?: number
  dimensionsCm?: Dimensions
  preferredCourierId?: string | number
  /** Seller tax/GST ID to stamp on the label (#348); resolved by the caller. */
  taxId?: string
  /**
   * Restrict items (and quantities) to what was actually delivered in this
   * completion, keyed by order_line_id. When omitted, the full ordered
   * quantity ships.
   */
  deliveredQuantities?: Record<string, number>
}

const lineName = (l: InventoryOrderLineForShipment): string => {
  const m = l.metadata || {}
  return (m.title || m.name || m.description || m.sku || "Inventory item") as string
}

export function buildInventoryOrderShipmentInput(
  order: InventoryOrderForShipment,
  opts: BuildInventoryShipmentOpts = {}
): CreateShipmentInput {
  const addr = order.shipping_address || {}
  const paymentMode: "prepaid" | "cod" =
    order.metadata?.payment_mode === "cod" ? "cod" : "prepaid"

  const items: ShipmentItem[] = (order.orderlines || [])
    .map((l) => {
      const delivered =
        opts.deliveredQuantities && l.id != null
          ? opts.deliveredQuantities[String(l.id)]
          : undefined
      const quantity = Number(delivered ?? l.quantity) || 0
      return {
        name: lineName(l),
        sku: (l.metadata?.sku as string) || undefined,
        quantity,
        unit_price: Number(l.price) || 0,
      }
    })
    .filter((i) => i.quantity > 0)

  const subTotal =
    order.total_price != null
      ? Number(order.total_price)
      : items.reduce((s, i) => s + i.unit_price * i.quantity, 0)

  const name =
    [addr.first_name, addr.last_name].filter(Boolean).join(" ") || "Warehouse"

  return {
    reference_id: order.id,
    payment_mode: paymentMode,
    cod_amount:
      paymentMode === "cod" ? Number(order.total_price) || subTotal : undefined,
    pickup_location_name: opts.pickupLocationName || "",
    to: {
      name,
      phone: addr.phone || "",
      email: addr.email || undefined,
      address_1: addr.address_1 || "",
      address_2: addr.address_2 || undefined,
      city: addr.city || "",
      state: addr.province || addr.state || "",
      pincode: addr.postal_code || "",
      country: addr.country_code ? String(addr.country_code).toUpperCase() : "IN",
    },
    items,
    weight_grams: opts.weightGrams || DEFAULT_INVENTORY_SHIPMENT_WEIGHT_GRAMS,
    dimensions_cm: opts.dimensionsCm,
    sub_total: subTotal,
    preferred_courier_id: opts.preferredCourierId,
    tax_id: opts.taxId,
  }
}
