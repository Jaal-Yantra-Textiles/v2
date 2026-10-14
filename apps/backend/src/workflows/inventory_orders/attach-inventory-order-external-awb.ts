import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { FULLFILLED_ORDERS_MODULE } from "../../modules/fullfilled_orders"

/**
 * Attach a waybill we did NOT book through POST .../shipment to an inventory
 * order — the inventory-side twin of POST /admin/orders/:id/external-awb.
 *
 * Booked on the carrier's portal or by hand because our booking could not
 * (HR Handloom, DTDC 7D138870713, 2026-10-14: DTDC could not allocate a pickup
 * hub for Bhuj until plugin 0.3.1), the parcel still has to show on the order:
 * as an inventory_shipment row linked to it — what the admin and partner UIs
 * list and the tracking sync follows — plus the metadata.shipment mirror older
 * readers use, and a timeline entry.
 *
 * NO carrier API is called. The operator holding the waybill is the authority.
 * A shipment is not a receipt: no stock moves here.
 */
export type AttachInventoryOrderExternalAwbInput = {
  orderId: string
  awb: string
  carrier: string
  trackingUrl?: string
  labelUrl?: string
  weightGrams?: number
  dimensionsCm?: { length?: number; breadth?: number; width?: number; height?: number }
  pickupStockLocationId?: string
  /** Why this was booked outside the system. Kept on the row and the timeline. */
  notes?: string
  /** Admin email recorded on the attachment, when known. */
  actingEmail?: string
}

export type AttachedInventoryShipment = {
  id: string
  awb: string
  carrier: string
  status: "created"
  tracking_url: string | null
}

export async function attachInventoryOrderExternalAwb(
  container: MedusaContainer,
  input: AttachInventoryOrderExternalAwbInput
): Promise<AttachedInventoryShipment> {
  const awb = input.awb.trim()
  const carrier = input.carrier.trim().toLowerCase()

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "inventory_orders",
    fields: [
      "id",
      "metadata",
      "inventory_shipments.id",
      "inventory_shipments.awb",
      "inventory_shipments.status",
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
  const existing = ((order.inventory_shipments || []) as any[]).find(
    (s) => s?.awb === awb && s?.status !== "cancelled"
  )
  if (existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `AWB ${awb} is already on inventory order ${input.orderId} (shipment ${existing.id}).`
    )
  }

  const attachment = {
    source: "external_awb",
    attached_by: input.actingEmail ?? null,
    attached_at: new Date().toISOString(),
    notes: input.notes ?? null,
  }

  // 1) The shipment row, linked to the order.
  const fulfilledOrders: any = container.resolve(FULLFILLED_ORDERS_MODULE)
  const record = await fulfilledOrders.createInventoryShipments({
    carrier,
    awb,
    tracking_number: awb,
    tracking_url: input.trackingUrl ?? null,
    label_url: input.labelUrl ?? null,
    pickup_stock_location_id: input.pickupStockLocationId ?? null,
    status: "created",
    weight_grams: input.weightGrams ?? null,
    dimensions_cm: input.dimensionsCm ?? null,
    metadata: { attachment },
  })
  const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
  await remoteLink.create([
    {
      [ORDER_INVENTORY_MODULE]: { inventory_orders_id: order.id },
      [FULLFILLED_ORDERS_MODULE]: { inventory_shipment_id: record.id },
    },
  ])

  // 2) The back-compat mirror, spread so the rest of metadata survives
  // (Medusa replaces metadata wholesale).
  const inventoryOrders: any = container.resolve(ORDER_INVENTORY_MODULE)
  await inventoryOrders.updateInventoryOrders({
    id: order.id,
    metadata: {
      ...((order.metadata as Record<string, any>) || {}),
      partner_tracking_number: awb,
      shipment: {
        carrier,
        awb,
        tracking_number: awb,
        tracking_url: input.trackingUrl ?? null,
        label_url: input.labelUrl ?? null,
        shipment_id: record.id,
        created_at: attachment.attached_at,
        external: true,
      },
    },
  })

  // 3) Timeline. Best-effort: the shipment row already exists.
  try {
    await inventoryOrders.createInventoryOrderActivities({
      inventory_order_id: order.id,
      activity_type: "lifecycle_event",
      kind: "shipment_attached",
      actor_type: "admin",
      actor_id: input.actingEmail ?? null,
      summary:
        `${carrier.toUpperCase()} AWB ${awb} attached (booked outside the system)` +
        (input.notes ? `: ${input.notes}` : ""),
      payload: { shipment_id: record.id, awb, carrier, ...attachment },
    })
  } catch (e) {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.warn(
      `AWB ${awb} attached to ${order.id} but the activity row failed: ${(e as Error)?.message}`
    )
  }

  return {
    id: record.id,
    awb,
    carrier,
    status: "created",
    tracking_url: input.trackingUrl ?? null,
  }
}
