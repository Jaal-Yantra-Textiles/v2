/**
 * #888 — pure decision logic for the carrier tracking webhook → inventory
 * shipment/order status sync. No container access so every rule is directly
 * unit-testable.
 *
 * Design decisions (locked with the operator):
 * - Shipment statuses only move FORWARD (a late/retried webhook can't regress
 *   a delivered shipment to in_transit).
 * - Order automation is status-only: picked up → order "Shipped", all
 *   non-cancelled shipments delivered → order "Delivered". Stock receipt /
 *   completion stays a manual confirmation — quantities can differ from what
 *   shipped, so the webhook never runs the completion workflow.
 * - Conservative order guard: only Processing / "Ready for Delivery" /
 *   Shipped orders are auto-advanced. Pending, Partial, Delivered and
 *   Cancelled are never touched by the webhook.
 */

export type InventoryShipmentStatus =
  | "created"
  | "pickup_scheduled"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "rto"
  | "cancelled"

export type InventoryOrderStatus =
  | "Pending"
  | "Processing"
  | "Ready for Delivery"
  | "Shipped"
  | "Delivered"
  | "Cancelled"
  | "Partial"

/** Subset of the provider `TrackingResult` the decisions need. */
export type TrackingSnapshot = {
  current_status?: string
  current_status_code?: number | string
}

/**
 * Map a carrier tracking push onto our shipment status. Returns null when the
 * push carries no status we track (pre-pickup noise like "AWB assigned" /
 * "manifest generated", NDR remarks, …) — the event is still recorded, the
 * status just doesn't move.
 *
 * Shiprocket's public status-ID table is poorly documented, so this matches on
 * the ids we've confirmed (6 SHIPPED, 7 DELIVERED, 9/10 RTO, 42 PICKED UP) and
 * falls back to label keywords for the rest. Raw payloads are persisted on the
 * shipment's metadata so the mapping can be tightened empirically.
 */
export function shipmentStatusFromTracking(
  tracking: TrackingSnapshot
): InventoryShipmentStatus | null {
  const code = Number(tracking.current_status_code)
  const label = String(tracking.current_status || "").toUpperCase()

  // RTO first — "RTO DELIVERED" must not read as delivered.
  if (code === 9 || code === 10 || label.includes("RTO")) return "rto"
  if (code === 7 || (label.includes("DELIVERED") && !label.includes("UNDELIVERED"))) {
    return "delivered"
  }
  if (label.includes("OUT FOR DELIVERY")) return "out_for_delivery"
  // 42 = PICKED UP, 6 = SHIPPED (handed to the courier network) — both mean
  // the goods have left the partner's warehouse.
  if (code === 42 || code === 6 || label.includes("PICKED UP") || label.includes("SHIPPED")) {
    return "picked_up"
  }
  if (label.includes("IN TRANSIT") || label.includes("REACHED") || label.includes("TRANSIT")) {
    return "in_transit"
  }
  if (label.includes("PICKUP SCHEDULED") || label.includes("PICKUP RESCHEDULED")) {
    return "pickup_scheduled"
  }
  if (label.includes("CANCEL")) return "cancelled"
  return null
}

/** Forward-only ordering of the shipment lifecycle. */
const SHIPMENT_STATUS_RANK: Record<InventoryShipmentStatus, number> = {
  created: 0,
  pickup_scheduled: 1,
  picked_up: 2,
  in_transit: 3,
  out_for_delivery: 4,
  rto: 5, // can supersede any in-flight state, but never a delivered shipment
  delivered: 6,
  cancelled: 7, // terminal — but see the explicit rules below
}

/**
 * May the shipment move `current` → `next`?
 * - never away from a terminal state (cancelled; delivered only "advances" on
 *   the rank scale, which nothing outranks except cancelled — blocked below),
 * - carrier-side cancellation only applies pre-pickup (created /
 *   pickup_scheduled); once goods moved, a "cancel" scan is recorded but the
 *   status keeps its history,
 * - otherwise strictly forward on the rank scale (idempotent on retries).
 */
export function shouldAdvanceShipmentStatus(
  current: InventoryShipmentStatus | string | null | undefined,
  next: InventoryShipmentStatus | null
): boolean {
  if (!next) return false
  const cur = (current || "created") as InventoryShipmentStatus
  if (cur === next) return false
  if (cur === "cancelled" || cur === "delivered") return false
  if (next === "cancelled") {
    return cur === "created" || cur === "pickup_scheduled"
  }
  const curRank = SHIPMENT_STATUS_RANK[cur]
  if (curRank === undefined) return false
  return SHIPMENT_STATUS_RANK[next] > curRank
}

/** Shipment statuses that mean the goods physically left the partner. */
const MOVING_STATUSES: ReadonlySet<InventoryShipmentStatus> = new Set([
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
])

/**
 * Decide whether the webhook should advance the ORDER, given the order's
 * current status and the statuses of ALL its shipments (post shipment-row
 * update). Returns the new order status or null (leave it alone).
 *
 * - "Shipped": any shipment is moving and the order still says Processing /
 *   Ready for Delivery.
 * - "Delivered": every non-cancelled shipment is delivered (≥1). One order can
 *   ship in several consignments, so a single delivery only closes the order
 *   when nothing else is still in flight.
 * - Pending (no goods should be moving), Partial (quantities are the operator's
 *   call), Delivered and Cancelled are never auto-changed.
 */
export function resolveOrderStatusUpdate(
  orderStatus: InventoryOrderStatus | string | null | undefined,
  shipmentStatuses: Array<InventoryShipmentStatus | string>
): "Shipped" | "Delivered" | null {
  const status = String(orderStatus || "")
  const active = shipmentStatuses
    .map((s) => s as InventoryShipmentStatus)
    .filter((s) => s !== "cancelled")
  if (!active.length) return null

  const allDelivered = active.every((s) => s === "delivered")
  if (allDelivered && ["Processing", "Ready for Delivery", "Shipped"].includes(status)) {
    return "Delivered"
  }
  const anyMoving = active.some((s) => MOVING_STATUSES.has(s))
  if (anyMoving && ["Processing", "Ready for Delivery"].includes(status)) {
    return "Shipped"
  }
  return null
}

export type TrackingEventRecord = {
  /** Carrier scan timestamp (as sent) — may be absent on sparse pushes. */
  at: string | null
  received_at: string
  status: string
  status_code: number | string | null
  location?: string | null
}

const TRACKING_EVENTS_CAP = 50

/**
 * Append a tracking event to the shipment's metadata blob, immutably.
 * Consecutive duplicates (same status + code — i.e. a webhook retry or an
 * unchanged-status scan) are skipped so retries stay idempotent. The list is
 * capped to the most recent TRACKING_EVENTS_CAP entries. The full raw payload
 * of the LAST push is kept under `last_webhook` for empirical status-ID
 * debugging (replaced each time, so the blob stays bounded).
 */
export function appendTrackingEvent(
  metadata: Record<string, any> | null | undefined,
  event: TrackingEventRecord,
  rawPayload?: any
): Record<string, any> {
  const existing: TrackingEventRecord[] = Array.isArray(metadata?.tracking_events)
    ? metadata!.tracking_events
    : []
  const last = existing[existing.length - 1]
  const isDuplicate =
    !!last &&
    last.status === event.status &&
    String(last.status_code ?? "") === String(event.status_code ?? "")
  const events = isDuplicate ? existing : [...existing, event].slice(-TRACKING_EVENTS_CAP)
  return {
    ...(metadata || {}),
    tracking_events: events,
    ...(rawPayload !== undefined ? { last_webhook: rawPayload } : {}),
  }
}
