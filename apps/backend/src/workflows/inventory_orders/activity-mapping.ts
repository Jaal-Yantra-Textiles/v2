import { INVENTORY_ORDER_STATUS_CHANGED_EVENT } from "./update-inventory-order";

/**
 * Pure mapping from an inventory-order event → an activity-log row input
 * (#778 H4). Free of any container/IO so it's unit-testable. Returns null for
 * events we don't record (the recorder then no-ops). Co-located with the event
 * constant; consumed by the src/subscribers recorder.
 */

export const INVENTORY_ORDER_ACTIVITY_EVENTS = [
  INVENTORY_ORDER_STATUS_CHANGED_EVENT,
  "inventory_order_assigned_to_partner",
  "inventory_order_partner_link_rolled_back",
] as const;

export type InventoryOrderActivityInput = {
  inventory_order_id: string;
  activity_type: "lifecycle_event" | "reminder_sent" | "note" | "system";
  kind: string;
  actor_type: "system" | "admin" | "partner" | "scheduled_flow";
  actor_id: string | null;
  partner_id: string | null;
  channel: "whatsapp" | "email" | "in_app" | null;
  message_id: string | null;
  template_name: string | null;
  recipient: string | null;
  summary: string | null;
  payload: Record<string, any> | null;
  occurred_at: Date;
};

export function buildInventoryOrderActivity(
  eventName: string,
  data: Record<string, any>,
  occurredAt: Date
): InventoryOrderActivityInput | null {
  const orderId = data.inventory_order_id || data.id || data.order?.id || null;
  if (!orderId) {
    return null;
  }

  const base = {
    inventory_order_id: String(orderId),
    activity_type: "lifecycle_event" as const,
    actor_type: "system" as const,
    actor_id: null,
    partner_id: data.partner_id ?? null,
    channel: null,
    message_id: null,
    template_name: null,
    recipient: null,
    occurred_at: occurredAt,
  };

  if (eventName === INVENTORY_ORDER_STATUS_CHANGED_EVENT) {
    const previous = data.previous_status ?? null;
    const status = data.status ?? null;
    if (!status) {
      return null;
    }
    return {
      ...base,
      kind: "status_changed",
      summary: previous
        ? `Status changed: ${previous} → ${status}`
        : `Status set: ${status}`,
      payload: { previous_status: previous, status },
    };
  }

  if (eventName === "inventory_order_assigned_to_partner") {
    return {
      ...base,
      kind: "assigned_to_partner",
      summary: "Order sent to partner",
      payload: data.notes ? { notes: data.notes } : null,
    };
  }

  if (eventName === "inventory_order_partner_link_rolled_back") {
    return {
      ...base,
      kind: "partner_link_rolled_back",
      summary: "Partner assignment rolled back",
      payload: data.reason ? { reason: data.reason } : null,
    };
  }

  return null;
}
