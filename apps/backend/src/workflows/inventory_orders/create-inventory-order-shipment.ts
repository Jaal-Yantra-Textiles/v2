import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
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
import { buildInventoryOrderShipmentInput } from "./lib/inventory-order-shipment"

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

  const taxId = await resolvePlatformTaxIdForCountry(
    container,
    (order as any)?.shipping_address?.country_code || "IN"
  )

  const shipmentInput = buildInventoryOrderShipmentInput(order as any, {
    pickupLocationName,
    weightGrams: input.weightGrams,
    dimensionsCm: input.dimensionsCm,
    preferredCourierId: input.preferredCourierId,
    taxId,
    deliveredQuantities: input.deliveredQuantities,
  })
  const result = await provider.createShipment(shipmentInput)

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
      },
    },
  })

  return result
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
