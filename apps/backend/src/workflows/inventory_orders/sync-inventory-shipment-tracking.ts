import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import type { IEventBusModuleService } from "@medusajs/types"
import { FULLFILLED_ORDERS_MODULE } from "../../modules/fullfilled_orders"
import type { TrackingResult } from "../../modules/shipping-providers/provider-interface"
import { updateInventoryOrderWorkflow } from "./update-inventory-order"
import {
  appendTrackingEvent,
  resolveOrderStatusUpdate,
  shipmentStatusFromTracking,
  shouldAdvanceShipmentStatus,
  type InventoryShipmentStatus,
} from "./lib/shipment-tracking"

/**
 * Shipment-level counterpart of the order status-changed event (#888). Fired
 * only on a real shipment status transition (webhook retries are deduped by
 * the forward-only guard), so visual flows can notify partners about pickup /
 * transit milestones without listening to raw carrier payloads.
 */
export const INVENTORY_SHIPMENT_STATUS_CHANGED_EVENT =
  "inventory_orders.inventory-shipment.status-changed"

export type SyncInventoryShipmentTrackingInput = {
  /** Normalized carrier push (from `normalizeShiprocketWebhook` or a future carrier). */
  tracking: Pick<
    TrackingResult,
    "carrier" | "awb" | "current_status" | "current_status_code" | "estimated_delivery"
  > & { raw?: any }
}

export type SyncInventoryShipmentTrackingResult = {
  matched: boolean
  shipment_id?: string
  previous_shipment_status?: string
  shipment_status?: string
  shipment_status_changed?: boolean
  order_id?: string
  previous_order_status?: string
  order_status?: string
  order_status_changed?: boolean
}

/**
 * Apply one carrier tracking push to the matching `inventory_shipment` row and
 * — when the goods actually moved — to its inventory order (#888, Default
 * behavior: status automation only; stock receipt stays manual).
 *
 * Flow: find shipment by AWB → append the event to `metadata.tracking_events`
 * (always, even when the status doesn't move — that history is how we confirm
 * Shiprocket's under-documented status ids) → advance the shipment status
 * behind the forward-only guard → emit the shipment status-changed event →
 * recompute the order status across ALL the order's shipments and route any
 * change through `updateInventoryOrderWorkflow`, so the existing
 * `inventory-order.status-changed` event (partner WhatsApp flow #771, activity
 * log, unified-order mirror) fires exactly as if an operator moved the order.
 */
export async function syncInventoryShipmentTracking(
  container: MedusaContainer,
  input: SyncInventoryShipmentTrackingInput
): Promise<SyncInventoryShipmentTrackingResult> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const fulfilledOrders: any = container.resolve(FULLFILLED_ORDERS_MODULE)
  const tracking = input.tracking

  const awb = String(tracking.awb || "").trim()
  if (!awb) return { matched: false }

  const shipments = await fulfilledOrders.listInventoryShipments({ awb })
  const shipment = (Array.isArray(shipments) ? shipments : [shipments]).filter(Boolean)[0]
  if (!shipment) {
    // Not ours to handle — the account-level webhook also carries core-order
    // shipments (routed in #886). 200-and-log is the contract.
    return { matched: false }
  }

  const previousStatus = String(shipment.status || "created")
  const mapped = shipmentStatusFromTracking(tracking)
  const advance = shouldAdvanceShipmentStatus(previousStatus, mapped)
  const nextStatus: string = advance ? (mapped as InventoryShipmentStatus) : previousStatus

  const metadata = appendTrackingEvent(
    shipment.metadata,
    {
      at: null,
      received_at: new Date().toISOString(),
      status: String(tracking.current_status || ""),
      status_code: tracking.current_status_code ?? null,
    },
    tracking.raw
  )

  await fulfilledOrders.updateInventoryShipments({
    id: shipment.id,
    status: nextStatus,
    metadata,
  })

  // Resolve the linked order (and its sibling shipments) through the
  // inventory-orders ⇄ inventory-shipments link.
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  let order: { id: string; status: string } | null = null
  let siblingStatuses: string[] = [nextStatus]
  try {
    const { data } = await query.graph({
      entity: "inventory_shipment",
      fields: ["id", "inventory_orders.id", "inventory_orders.status"],
      filters: { id: shipment.id },
    })
    const linked = (data?.[0]?.inventory_orders || []).filter(Boolean)[0]
    if (linked?.id) {
      const { data: orders } = await query.graph({
        entity: "inventory_orders",
        fields: ["id", "status", "inventory_shipments.id", "inventory_shipments.status"],
        filters: { id: linked.id },
      })
      const row = orders?.[0]
      if (row?.id) {
        order = { id: row.id, status: String(row.status || "") }
        siblingStatuses = (row.inventory_shipments || [])
          .filter(Boolean)
          .map((s: any) => (s.id === shipment.id ? nextStatus : String(s.status || "created")))
      }
    }
  } catch (e) {
    logger.warn(
      `[Shipping Webhook] Could not resolve the order linked to shipment ${shipment.id} (AWB ${awb}): ${(e as Error)?.message}`
    )
  }

  if (advance) {
    try {
      const eventBus = container.resolve(Modules.EVENT_BUS) as IEventBusModuleService
      await eventBus.emit({
        name: INVENTORY_SHIPMENT_STATUS_CHANGED_EVENT,
        data: {
          id: shipment.id,
          awb,
          carrier: shipment.carrier,
          previous_status: previousStatus,
          status: nextStatus,
          order_id: order?.id ?? null,
          pickup_scheduled_date: shipment.pickup_scheduled_date ?? null,
        },
      })
    } catch {
      /* best-effort — tracking sync must not fail on event emit */
    }
  }

  const result: SyncInventoryShipmentTrackingResult = {
    matched: true,
    shipment_id: shipment.id,
    previous_shipment_status: previousStatus,
    shipment_status: nextStatus,
    shipment_status_changed: advance,
    order_id: order?.id,
    previous_order_status: order?.status,
    order_status: order?.status,
    order_status_changed: false,
  }

  if (order) {
    const desired = resolveOrderStatusUpdate(order.status, siblingStatuses)
    if (desired && desired !== order.status) {
      await updateInventoryOrderWorkflow(container).run({
        input: { id: order.id, update: { status: desired } },
      })
      result.order_status = desired
      result.order_status_changed = true
    }
  }

  return result
}

const syncInventoryShipmentTrackingStep = createStep(
  "sync-inventory-shipment-tracking",
  async (input: SyncInventoryShipmentTrackingInput, { container }) => {
    const result = await syncInventoryShipmentTracking(container, input)
    return new StepResponse(result)
  }
)

export const syncInventoryShipmentTrackingWorkflow = createWorkflow(
  "sync-inventory-shipment-tracking",
  (input: SyncInventoryShipmentTrackingInput) => {
    const result = syncInventoryShipmentTrackingStep(input)
    return new WorkflowResponse(result)
  }
)
