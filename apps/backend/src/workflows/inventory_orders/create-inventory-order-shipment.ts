import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import type { IEventBusModuleService } from "@medusajs/types"
import { INVENTORY_SHIPMENT_STATUS_CHANGED_EVENT } from "./sync-inventory-shipment-tracking"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { FULLFILLED_ORDERS_MODULE } from "../../modules/fullfilled_orders"
import InventoryOrdersStockLocationsLink from "../../links/inventory-orders-stock-locations"
import { resolveShippingProvider } from "../../modules/shipping-providers/resolver"
import {
  SHIPROCKET_PICKUP_METADATA_KEY,
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
 * Pickup bootstrap: the explicit pickup input or the order's from_location is
 * ensured to be a registered carrier pickup via `registerShiprocketPickup`
 * (metadata warehouse key used as-is when present; else lists first, then
 * registers from the location's address). There is NO fallback to another
 * registered pickup — all parties share one Shiprocket account, so that would
 * ship from someone else's warehouse. A clean MedusaError (not a 500) is
 * thrown when no pickup can be resolved so the UI shows an actionable message.
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

  // The order's from/to stock-location links drive both ends of the shipment:
  // from_location is the pickup (ship-from), to_location the destination.
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  let toLocation: any = null
  let fromLocation: any = null
  try {
    const { data: links } = await query.graph({
      entity: (InventoryOrdersStockLocationsLink as any).entryPoint,
      fields: [
        "to_location",
        "from_location",
        "stock_location.id",
        "stock_location.name",
        "stock_location.metadata",
        "stock_location.address.*",
      ],
      filters: { inventory_orders_id: order.id },
    })
    toLocation = (links || []).find((l: any) => l?.to_location)?.stock_location || null
    fromLocation = (links || []).find((l: any) => l?.from_location)?.stock_location || null
  } catch {
    // best-effort — the guards below produce the actionable errors
  }

  // Pickup = the shipment's true source, never a guess. Priority: explicit
  // input → the order's own from_location. There is deliberately NO
  // any-registered-pickup fallback: all partners share one Shiprocket account,
  // so "first registered pickup" is some OTHER party's warehouse — that
  // fallback is how a partner's shipment got assigned to the wrong warehouse.
  // A from_location whose metadata already carries the Shiprocket warehouse
  // key (shiprocket_pickup_location) is used as-is; otherwise it's registered
  // on the fly (idempotent — the nickname is recorded back on the location's
  // metadata). If neither works this is a 400 with the reason, not a silent
  // wrong-origin shipment. The rates flow (shiprocket-rates.ts) already quotes
  // from the from_location, so quoted origin and real origin agree.
  let pickupLocationName: string | undefined
  const pickupStockLocationId = input.pickupStockLocationId || fromLocation?.id
  if (input.pickupStockLocationId) {
    const reg = await registerShiprocketPickup(container, input.pickupStockLocationId, {
      email: input.actingEmail,
    })
    pickupLocationName = reg.name
  } else if (fromLocation) {
    const recordedNickname = (fromLocation.metadata as any)?.[
      SHIPROCKET_PICKUP_METADATA_KEY
    ] as string | undefined
    if (recordedNickname) {
      // Already registered — the metadata key is the carrier-side warehouse id.
      pickupLocationName = recordedNickname
    } else {
      try {
        const reg = await registerShiprocketPickup(container, fromLocation.id, {
          email: input.actingEmail,
        })
        pickupLocationName = reg.name
      } catch (e: any) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `The order's source location "${fromLocation.name || fromLocation.id}" could not be registered as a carrier pickup: ${e?.message}. Complete its address (phone + pincode) or register it as a Shiprocket pickup, then retry.`
        )
      }
    }
  }
  if (!pickupLocationName) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The order has no source stock location to pick up from. Set the order's from-location (or pass an explicit pickup location) before generating a shipment."
    )
  }

  const provider = await resolveShippingProvider(container, carrier)
  if (!provider.createShipment) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `${carrier} provider does not support shipment creation`
    )
  }

  // Destination (ship-to) address: the order's linked `to_location` stock
  // location is the physical destination and carries a complete structured
  // address; the free-form `shipping_address` JSON is often just
  // `{ city, country_code }`. Fill from the to-location, letting any explicit
  // shipping_address field win, so Shiprocket's required billing fields are
  // populated (#772 — "The billing address field is required").

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

  // Persist the shipment as a first-class record linked to the order, so
  // multiple consignments coexist, the resolved pickup identity is auditable,
  // and both admin/partner UIs can list shipments. Best-effort: the carrier
  // shipment already exists, so a persistence hiccup must not fail the call.
  let shipmentRecordId: string | undefined
  try {
    const fulfilledOrdersService: any = container.resolve(FULLFILLED_ORDERS_MODULE)
    const record = await fulfilledOrdersService.createInventoryShipments({
      carrier,
      awb: result.awb ?? null,
      tracking_number: result.tracking_number ?? null,
      tracking_url: result.tracking_url ?? null,
      label_url: result.label_url ?? null,
      pickup_location_name: pickupLocationName,
      pickup_stock_location_id: pickupStockLocationId ?? null,
      pickup_scheduled_date: pickup?.scheduled_date ?? input.pickupDate ?? null,
      status: pickup ? "pickup_scheduled" : "created",
      weight_grams: input.weightGrams ?? null,
      dimensions_cm: input.dimensionsCm ?? null,
      provider_refs: result.provider_refs ?? null,
    })
    shipmentRecordId = record.id
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
    await remoteLink.create([
      {
        [ORDER_INVENTORY_MODULE]: { inventory_orders_id: order.id },
        [FULLFILLED_ORDERS_MODULE]: { inventory_shipment_id: record.id },
      },
    ])
    // A pickup was scheduled at creation, so the shipment is born past the
    // webhook's created→pickup_scheduled transition — emit the shipment
    // status-changed event ourselves so the #888 pickup WhatsApp flow tells
    // the partner a courier is coming, regardless of who created the shipment.
    if (pickup) {
      try {
        const eventBus = container.resolve(Modules.EVENT_BUS) as IEventBusModuleService
        await eventBus.emit({
          name: INVENTORY_SHIPMENT_STATUS_CHANGED_EVENT,
          data: {
            id: record.id,
            awb: result.awb ?? null,
            carrier,
            previous_status: "created",
            status: "pickup_scheduled",
            order_id: order.id,
            pickup_scheduled_date: pickup.scheduled_date ?? input.pickupDate ?? null,
          },
        })
      } catch {
        /* best-effort — shipment creation must not fail on event emit */
      }
    }
  } catch (e) {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.error(
      `Failed to persist inventory_shipment record for order ${order.id} (AWB ${result.awb}):`,
      e as Error
    )
  }

  // Metadata mirror kept for back-compat readers (older UI surfaces read
  // metadata.shipment; free-text tracking number becomes the real AWB). Spread
  // the existing metadata so the whole blob isn't clobbered (Medusa replaces
  // metadata wholesale).
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
        pickup_location_name: pickupLocationName,
        ...(shipmentRecordId ? { shipment_id: shipmentRecordId } : {}),
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
