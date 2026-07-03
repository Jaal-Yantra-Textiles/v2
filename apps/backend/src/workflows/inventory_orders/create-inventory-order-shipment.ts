import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import InventoryOrdersStockLocationsLink from "../../links/inventory-orders-stock-locations"
import { resolveShippingProvider } from "../../modules/shipping-providers/resolver"
import {
  chooseRegisteredPickup,
  registerShiprocketPickup,
} from "../../modules/shipping-providers/pickup-locations"
import { resolvePlatformTaxIdForCountry } from "../../modules/shipping-providers/seller-tax-id"
import type {
  Dimensions,
  ShipmentResult,
} from "../../modules/shipping-providers/provider-interface"
import {
  buildInventoryOrderShipmentInput,
  missingDestinationAddressFields,
  normalizeDimensionsCm,
  resolveInventoryDestinationAddress,
} from "./lib/inventory-order-shipment"

/**
 * Generate a real carrier shipment (forward → AWB → label) for a partner
 * inventory-order completion and persist the carrier refs onto the inventory
 * order (#772). Opt-in: invoked only when the partner asked to generate a
 * shipment; the legacy free-text `partner_tracking_number` path is untouched
 * otherwise.
 *
 * Pickup bootstrap: when a source stock location is given, ensure it's a
 * registered carrier pickup via `registerShiprocketPickup` (lists first, then
 * registers from the location's address — handles the "first time, no pickup
 * yet" case). Otherwise fall back to any registered pickup. A clean
 * MedusaError (not a 500) is thrown when no pickup can be resolved so the UI
 * shows an actionable message.
 */

export type CreateInventoryOrderShipmentInput = {
  orderId: string
  /** Defaults to "shiprocket". */
  carrier?: string
  /** Source stock location to ship from; auto-registered as a pickup if new. */
  pickupStockLocationId?: string
  weightGrams?: number
  dimensionsCm?: Dimensions
  preferredCourierId?: string | number
  /** Delivered quantities keyed by order_line_id (restricts shipment items). */
  deliveredQuantities?: Record<string, number>
  /** Acting user's email recorded on a freshly-registered pickup (#427). */
  actingEmail?: string
  /**
   * Requested carrier pickup date ("YYYY-MM-DD"). When set, a pickup is
   * scheduled for that date after the shipment is created; otherwise Shiprocket
   * picks the earliest slot.
   */
  pickupDate?: string
}

export async function createInventoryOrderShipment(
  container: MedusaContainer,
  input: CreateInventoryOrderShipmentInput
): Promise<ShipmentResult> {
  const carrier = input.carrier || "shiprocket"
  const inventoryOrderService: any = container.resolve(ORDER_INVENTORY_MODULE)

  const order = await inventoryOrderService.retrieveInventoryOrder(input.orderId, {
    select: ["id", "total_price", "metadata", "shipping_address"],
    relations: ["orderlines"],
  })
  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order ${input.orderId} not found`
    )
  }

  // Pickup: register/confirm from the source stock location when provided
  // (idempotent — lists then registers, recording the nickname on the
  // location's metadata so later shipments skip it).
  let pickupLocationName: string | undefined
  if (input.pickupStockLocationId) {
    const reg = await registerShiprocketPickup(container, input.pickupStockLocationId, {
      email: input.actingEmail,
    })
    pickupLocationName = reg.name
  }

  const provider = await resolveShippingProvider(container, carrier)
  if (!provider.createShipment) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `${carrier} provider does not support shipment creation`
    )
  }

  if (!pickupLocationName && provider.listPickupLocations) {
    try {
      pickupLocationName = chooseRegisteredPickup(await provider.listPickupLocations())?.name
    } catch {
      // best-effort — the guard below produces the actionable error
    }
  }
  if (!pickupLocationName) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No carrier pickup location is configured. Register a pickup for the order's source stock location (or any carrier pickup) before generating a shipment."
    )
  }

  // Destination (ship-to) address: the order's linked `to_location` stock
  // location is the physical destination and carries a complete structured
  // address; the free-form `shipping_address` JSON is often just
  // `{ city, country_code }`. Fill from the to-location, letting any explicit
  // shipping_address field win, so Shiprocket's required billing fields are
  // populated (#772 — "The billing address field is required").
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  let toLocation: any = null
  try {
    const { data: links } = await query.graph({
      entity: (InventoryOrdersStockLocationsLink as any).entryPoint,
      fields: ["to_location", "stock_location.name", "stock_location.address.*"],
      filters: { inventory_orders_id: order.id },
    })
    toLocation = (links || []).find((l: any) => l?.to_location)?.stock_location || null
  } catch {
    // best-effort — the guard below produces the actionable error
  }

  const destinationAddress = resolveInventoryDestinationAddress(
    (order as any)?.shipping_address,
    toLocation?.address,
    toLocation?.name
  )

  const missing = missingDestinationAddressFields(destinationAddress)
  if (missing.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Destination address is incomplete (missing ${missing.join(", ")}). ` +
        `Set a complete address on the order's destination stock location, or on the order's shipping address, before generating a shipment.`
    )
  }

  // Resolve each line's real inventory_item SKU (the line itself has no sku
  // column). Without this, no-SKU lines collapse to one repeated fallback and
  // Shiprocket 400s "SKU cannot be repeated"; with it, colour variants carry
  // their true unique SKUs (e.g. OTH-TAN-BLA-001). Best-effort — the builder
  // still distinguishes lines by material_name + colour if this lookup fails.
  let orderlines: any[] = (order as any).orderlines || []
  try {
    const { data: rows } = await query.graph({
      entity: "inventory_orders",
      fields: ["orderlines.id", "orderlines.inventory_items.sku"],
      filters: { id: order.id },
    })
    const skuByLine = new Map<string, string>()
    for (const ol of rows?.[0]?.orderlines || []) {
      const sku = (ol?.inventory_items || [])[0]?.sku
      if (ol?.id && sku) skuByLine.set(String(ol.id), String(sku))
    }
    orderlines = orderlines.map((l) => ({
      ...l,
      sku: l.sku ?? skuByLine.get(String(l.id)) ?? null,
    }))
  } catch {
    // best-effort — name-based distinctness (material_name + colour) still holds
  }

  const orderForShipment = {
    ...(order as any),
    orderlines,
    shipping_address: destinationAddress,
  }

  const taxId = await resolvePlatformTaxIdForCountry(
    container,
    destinationAddress.country_code || "IN"
  )

  const shipmentInput = buildInventoryOrderShipmentInput(orderForShipment as any, {
    pickupLocationName,
    weightGrams: input.weightGrams,
    // Map breadth → width so the operator-entered breadth reaches the courier
    // (the client reads dimensions_cm.width); undefined dims still default.
    dimensionsCm: normalizeDimensionsCm(input.dimensionsCm as any),
    preferredCourierId: input.preferredCourierId,
    taxId,
    deliveredQuantities: input.deliveredQuantities,
  })
  const result = await provider.createShipment(shipmentInput)

  // Schedule the carrier pickup for the requested date (best-effort — the
  // shipment already exists; a scheduling hiccup must not fail the whole call).
  let pickup: { scheduled_date?: string; token?: string } | undefined
  if (input.pickupDate && provider.schedulePickup) {
    try {
      const scheduled = await provider.schedulePickup({
        pickup_location_name: pickupLocationName,
        ref: { awb: result.awb, provider_refs: result.provider_refs },
        pickup_date: input.pickupDate,
      })
      pickup = {
        scheduled_date: scheduled.scheduled_date,
        token: scheduled.token,
      }
    } catch {
      // non-fatal — operator can reschedule from the carrier dashboard
    }
  }

  // Persist carrier refs onto the inventory order, replacing the free-text
  // tracking number with the real AWB. Spread the existing metadata so the
  // whole blob isn't clobbered (Medusa replaces metadata wholesale).
  await inventoryOrderService.updateInventoryOrders({
    id: order.id,
    metadata: {
      ...((order as any).metadata || {}),
      partner_tracking_number: result.tracking_number || result.awb,
      shipment: {
        carrier,
        awb: result.awb,
        tracking_number: result.tracking_number,
        tracking_url: result.tracking_url,
        label_url: result.label_url,
        provider_refs: result.provider_refs,
        created_at: new Date().toISOString(),
        ...(pickup ? { pickup } : {}),
      },
    },
  })

  return { ...result, ...(pickup ? { pickup } : {}) }
}

const createInventoryOrderShipmentStep = createStep(
  "create-inventory-order-shipment",
  async (input: CreateInventoryOrderShipmentInput, { container }) => {
    const result = await createInventoryOrderShipment(container, input)
    return new StepResponse(result)
  }
)

export const createInventoryOrderShipmentWorkflow = createWorkflow(
  "create-inventory-order-shipment",
  (input: CreateInventoryOrderShipmentInput) => {
    const result = createInventoryOrderShipmentStep(input)
    return new WorkflowResponse(result)
  }
)
