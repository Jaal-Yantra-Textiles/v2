import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  createOrderShipmentWorkflow,
  markOrderFulfillmentAsDeliveredWorkflow,
} from "@medusajs/medusa/core-flows"
import type { TrackingResult } from "../../modules/shipping-providers/provider-interface"
import { deriveFulfillmentState } from "./shiprocket-attach-awb"
import { appendTrackingEvent } from "../inventory_orders/lib/shipment-tracking"

/**
 * Core-order counterpart of `syncInventoryShipmentTracking` (#888 → #1111).
 *
 * The account-level Shiprocket webhook carries BOTH inventory-order shipments
 * (matched on the `inventory_shipment.awb` column) AND retail/core-order
 * shipments — the latter store their AWB only on `fulfillment.data`, so they
 * were previously logged-and-swallowed. This routes a core-order push to its
 * fulfillment and advances the order's fulfillment status (shipped → delivered)
 * from the carrier's real state, the same way `attachExistingShiprocketAwb`
 * does on demand. Works identically for domestic and international shipments —
 * both persist a `fulfillment_label` with the AWB as its tracking number.
 *
 * Forward-only + idempotent: a fulfillment already shipped/delivered isn't
 * re-shipped/re-delivered, so webhook retries and out-of-order pushes are safe.
 */

export type SyncOrderShipmentTrackingInput = {
  tracking: Pick<
    TrackingResult,
    "carrier" | "awb" | "current_status" | "current_status_code" | "estimated_delivery"
  > & { raw?: any }
}

export type SyncOrderShipmentTrackingResult = {
  matched: boolean
  fulfillment_id?: string
  order_id?: string
  /** What we advanced the fulfillment to (or left it at). */
  synced_state?: "shipped" | "delivered" | "pending"
  status_changed?: boolean
}

export type FulfillmentTimestamps = {
  shipped_at?: unknown
  delivered_at?: unknown
  canceled_at?: unknown
}

export type FulfillmentSyncAction = "none" | "ship" | "deliver" | "ship_and_deliver"

/**
 * Pure forward-only decision: given the carrier-derived coarse state and the
 * fulfillment's current shipped/delivered/canceled timestamps, what should the
 * webhook do? Never regresses (a delivered fulfillment stays delivered), never
 * touches a canceled one, and idempotently no-ops when already in the target
 * state. Exported for unit testing.
 */
export function resolveFulfillmentSyncAction(
  derived: "delivered" | "shipped" | "pending",
  f: FulfillmentTimestamps | null | undefined
): FulfillmentSyncAction {
  if (f?.canceled_at) return "none"
  const shipped = !!f?.shipped_at
  const delivered = !!f?.delivered_at
  if (derived === "delivered") {
    if (delivered) return "none"
    return shipped ? "deliver" : "ship_and_deliver"
  }
  if (derived === "shipped") {
    return shipped ? "none" : "ship"
  }
  return "none"
}

export async function syncOrderShipmentTracking(
  container: MedusaContainer,
  input: SyncOrderShipmentTrackingInput
): Promise<SyncOrderShipmentTrackingResult> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModule: any = container.resolve(Modules.FULFILLMENT)
  const tracking = input.tracking

  const awb = String(tracking.awb || "").trim()
  if (!awb) return { matched: false }

  // AWB → core fulfillment, via the queryable label tracking number the
  // shipment flow stamps on generation (data.waybill is JSONB and can't be
  // filtered). Filter fulfillments by the nested `labels.tracking_number`, then
  // confirm the match in JS (defensive against a filter that over-returns).
  const { data: fulfillments } = await query.graph({
    entity: "fulfillment",
    fields: [
      "id",
      "data",
      "shipped_at",
      "delivered_at",
      "canceled_at",
      "labels.tracking_number",
      "order.id",
      "order.items.id",
      "order.items.detail.quantity",
      "order.items.quantity",
    ],
    filters: { labels: { tracking_number: awb } },
  })
  const fulfillment = (fulfillments || []).find((f: any) =>
    (f?.labels || []).some((l: any) => l?.tracking_number === awb)
  )
  if (!fulfillment) {
    // Not a core-order shipment we know (or the inventory path already handled
    // it) — 200-and-log is the webhook contract.
    return { matched: false }
  }
  const fulfillmentId = fulfillment.id
  const order = fulfillment.order
  const orderId = order?.id

  // Always record the scan (even when the status doesn't move) — the history is
  // how Shiprocket's under-documented status ids get confirmed empirically.
  const data = appendTrackingEvent(
    fulfillment.data,
    {
      at: null,
      received_at: new Date().toISOString(),
      status: String(tracking.current_status || ""),
      status_code: tracking.current_status_code ?? null,
    },
    tracking.raw
  )
  await fulfillmentModule.updateFulfillment(fulfillmentId, { data })

  const derived = deriveFulfillmentState(
    tracking.current_status_code != null
      ? Number(tracking.current_status_code)
      : undefined,
    tracking.current_status
  )
  const action = resolveFulfillmentSyncAction(derived, fulfillment)

  const result: SyncOrderShipmentTrackingResult = {
    matched: true,
    fulfillment_id: fulfillmentId,
    order_id: orderId,
    synced_state: derived,
    status_changed: false,
  }

  if (action === "none" || !orderId) {
    return result
  }

  const items = (order.items || []).map((i: any) => ({
    id: i.id,
    quantity: Number(i.detail?.quantity ?? i.quantity) || 1,
  }))

  // Mark shipped (labels already exist from generation — pass none to avoid dupes).
  if (action === "ship" || action === "ship_and_deliver") {
    try {
      await createOrderShipmentWorkflow(container).run({
        input: {
          order_id: orderId,
          fulfillment_id: fulfillmentId,
          items,
          labels: [],
          no_notification: true,
        },
      })
      result.status_changed = true
    } catch (e: any) {
      logger.warn(
        `[Shipping Webhook] mark-shipped skipped for fulfillment ${fulfillmentId} (AWB ${awb}): ${e?.message}`
      )
    }
  }

  if (action === "deliver" || action === "ship_and_deliver") {
    try {
      await markOrderFulfillmentAsDeliveredWorkflow(container).run({
        input: {
          orderId: orderId,
          fulfillmentId: fulfillmentId,
          no_notification: true,
        } as any,
      })
      result.status_changed = true
    } catch (e: any) {
      logger.warn(
        `[Shipping Webhook] mark-delivered skipped for fulfillment ${fulfillmentId} (AWB ${awb}): ${e?.message}`
      )
    }
  }

  return result
}

const syncOrderShipmentTrackingStep = createStep(
  "sync-order-shipment-tracking",
  async (input: SyncOrderShipmentTrackingInput, { container }) => {
    const result = await syncOrderShipmentTracking(container, input)
    return new StepResponse(result)
  }
)

export const syncOrderShipmentTrackingWorkflow = createWorkflow(
  "sync-order-shipment-tracking",
  (input: SyncOrderShipmentTrackingInput) => {
    const result = syncOrderShipmentTrackingStep(input)
    return new WorkflowResponse(result)
  }
)
