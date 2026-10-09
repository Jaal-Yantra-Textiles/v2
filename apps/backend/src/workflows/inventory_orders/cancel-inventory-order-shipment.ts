import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { FULLFILLED_ORDERS_MODULE } from "../../modules/fullfilled_orders"
import { resolveShippingProvider } from "../../modules/shipping-providers/resolver"

/**
 * Cancel one carrier shipment (AWB) on an inventory order.
 *
 * The core-order side has had this since cancel-shipment.ts; the inventory
 * side had nothing, so a supplier pickup that failed (HR Handloom, AWB
 * 4867629825960, "not ready" then "not attempted", 2026-10-05/06) could only
 * be killed on the Shiprocket dashboard or with a hand-rolled curl, and a
 * rebook on top of a LIVE carrier order is a no-op: `create/adhoc` hands back
 * the existing order for a repeated channel order id.
 *
 * Same ordering rule as the core flow: cancel at the CARRIER first, and only
 * then mark our row cancelled. If the carrier refuses, this throws and nothing
 * here changes, so we never stop pointing at a live, billable waybill.
 *
 * No partner message is sent and no status-changed event is emitted: the
 * visual flows listening on that event are about a courier COMING, and a
 * cancellation must not trip them.
 */

/** Statuses where the parcel has not entered the carrier network yet. */
const CANCELLABLE_STATUSES = new Set(["created", "pickup_scheduled"])

export type CancelInventoryOrderShipmentInput = {
  orderId: string
  shipmentId: string
  reason?: string
  /** Cancel even when the carrier already reports the parcel picked up. */
  force?: boolean
  /** Admin email recorded on the cancellation, when known. */
  actingEmail?: string
}

export type CancelledInventoryShipment = {
  id: string
  awb: string | null
  carrier: string
  previous_status: string
  status: "cancelled"
  cancelled_at: string
  cancelled_by: string | null
  reason: string | null
}

/**
 * Pure guard: may a shipment in `status` be cancelled? Throws the error the
 * route should surface. Exported for unit tests.
 */
export function assertInventoryShipmentCancellable(
  status: string | null | undefined,
  force = false
): void {
  const s = String(status || "created")
  if (s === "cancelled") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This shipment is already cancelled."
    )
  }
  if (!CANCELLABLE_STATUSES.has(s) && !force) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `The carrier reports this shipment as '${s}', so the parcel is already in its network. ` +
        "Cancelling the waybill would strand it. Pass force: true only if you are sure the goods never left."
    )
  }
}

export async function cancelInventoryOrderShipment(
  container: MedusaContainer,
  input: CancelInventoryOrderShipmentInput
): Promise<CancelledInventoryShipment> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "inventory_orders",
    fields: [
      "id",
      "metadata",
      "inventory_shipments.id",
      "inventory_shipments.carrier",
      "inventory_shipments.awb",
      "inventory_shipments.status",
      "inventory_shipments.provider_refs",
      "inventory_shipments.metadata",
    ],
    filters: { id: input.orderId },
  })
  const order = data?.[0]
  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order ${input.orderId} not found`
    )
  }
  const shipment = ((order.inventory_shipments || []) as any[]).find(
    (s) => s?.id === input.shipmentId
  )
  if (!shipment) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Shipment ${input.shipmentId} is not on inventory order ${input.orderId}`
    )
  }

  const previousStatus = String(shipment.status || "created")
  assertInventoryShipmentCancellable(previousStatus, input.force === true)

  // 1) Carrier first. A refusal throws and leaves every row as it was.
  const provider = await resolveShippingProvider(container, shipment.carrier)
  let carrierResponse: any
  try {
    carrierResponse = await provider.cancelShipment({
      awb: shipment.awb ?? undefined,
      provider_refs: shipment.provider_refs ?? undefined,
    })
  } catch (e: any) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `The carrier refused to cancel AWB ${shipment.awb ?? "(none)"}: ${e?.message || e}. Nothing was changed here.`
    )
  }

  const cancelledAt = new Date().toISOString()
  const cancellation = {
    cancelled_at: cancelledAt,
    cancelled_by: input.actingEmail ?? null,
    reason: input.reason ?? null,
    previous_status: previousStatus,
    forced: input.force === true,
    carrier_response: carrierResponse?.raw ?? null,
  }

  // 2) Our shipment row.
  const fulfilledOrders: any = container.resolve(FULLFILLED_ORDERS_MODULE)
  await fulfilledOrders.updateInventoryShipments({
    id: shipment.id,
    status: "cancelled",
    metadata: { ...(shipment.metadata || {}), cancellation },
  })

  // 3) The back-compat metadata mirror. Older readers show metadata.shipment
  // as THE shipment; leaving a dead AWB there shows a parcel that will never
  // move. Archive it instead of dropping it.
  const inventoryOrders: any = container.resolve(ORDER_INVENTORY_MODULE)
  const meta = { ...((order.metadata as Record<string, any>) || {}) }
  if (shipment.awb && meta.shipment?.awb === shipment.awb) {
    meta.cancelled_shipments = [
      ...(Array.isArray(meta.cancelled_shipments) ? meta.cancelled_shipments : []),
      { ...meta.shipment, ...cancellation, carrier_response: undefined },
    ]
    delete meta.shipment
    if (meta.partner_tracking_number === shipment.awb) {
      delete meta.partner_tracking_number
    }
    await inventoryOrders.updateInventoryOrders({ id: order.id, metadata: meta })
  }

  // 4) Timeline. Best-effort: the cancel already happened at the carrier.
  try {
    await inventoryOrders.createInventoryOrderActivities({
      inventory_order_id: order.id,
      activity_type: "lifecycle_event",
      kind: "shipment_cancelled",
      actor_type: "admin",
      actor_id: input.actingEmail ?? null,
      summary:
        `Shipment AWB ${shipment.awb ?? "(none)"} cancelled` +
        (input.reason ? `: ${input.reason}` : ""),
      payload: {
        shipment_id: shipment.id,
        awb: shipment.awb ?? null,
        carrier: shipment.carrier,
        ...cancellation,
        carrier_response: undefined,
      },
    })
  } catch (e) {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.warn(
      `Shipment ${shipment.id} cancelled but the activity row failed: ${(e as Error)?.message}`
    )
  }

  return {
    id: shipment.id,
    awb: shipment.awb ?? null,
    carrier: shipment.carrier,
    previous_status: previousStatus,
    status: "cancelled",
    cancelled_at: cancelledAt,
    cancelled_by: input.actingEmail ?? null,
    reason: input.reason ?? null,
  }
}
