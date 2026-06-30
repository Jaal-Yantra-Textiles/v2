import {
  buildInventoryOrderActivity,
  INVENTORY_ORDER_ACTIVITY_EVENTS,
} from "../activity-mapping";
import { INVENTORY_ORDER_STATUS_CHANGED_EVENT } from "../update-inventory-order";

const OCCURRED = new Date("2026-06-30T12:00:00.000Z");

describe("buildInventoryOrderActivity (#778 H4)", () => {
  it("maps a status-changed event with previous → new", () => {
    const a = buildInventoryOrderActivity(
      INVENTORY_ORDER_STATUS_CHANGED_EVENT,
      { id: "inv_order_1", previous_status: "Processing", status: "Shipped" },
      OCCURRED
    );
    expect(a).toMatchObject({
      inventory_order_id: "inv_order_1",
      activity_type: "lifecycle_event",
      kind: "status_changed",
      summary: "Status changed: Processing → Shipped",
      payload: { previous_status: "Processing", status: "Shipped" },
      actor_type: "system",
      occurred_at: OCCURRED,
    });
  });

  it("handles an initial status set (no previous)", () => {
    const a = buildInventoryOrderActivity(
      INVENTORY_ORDER_STATUS_CHANGED_EVENT,
      { id: "inv_order_1", previous_status: null, status: "Pending" },
      OCCURRED
    );
    expect(a?.summary).toBe("Status set: Pending");
  });

  it("maps assigned-to-partner with partner_id + notes", () => {
    const a = buildInventoryOrderActivity(
      "inventory_order_assigned_to_partner",
      { inventory_order_id: "inv_order_2", partner_id: "p_1", notes: "rush" },
      OCCURRED
    );
    expect(a).toMatchObject({
      inventory_order_id: "inv_order_2",
      kind: "assigned_to_partner",
      partner_id: "p_1",
      summary: "Order sent to partner",
      payload: { notes: "rush" },
    });
  });

  it("maps partner-link rollback with reason", () => {
    const a = buildInventoryOrderActivity(
      "inventory_order_partner_link_rolled_back",
      { inventory_order_id: "inv_order_3", partner_id: "p_1", reason: "workflow_rollback" },
      OCCURRED
    );
    expect(a).toMatchObject({
      kind: "partner_link_rolled_back",
      partner_id: "p_1",
      payload: { reason: "workflow_rollback" },
    });
  });

  it("returns null for an unknown event", () => {
    expect(
      buildInventoryOrderActivity("inventory_order.something_else", { id: "x" }, OCCURRED)
    ).toBeNull();
  });

  it("returns null when no order id is resolvable", () => {
    expect(
      buildInventoryOrderActivity(INVENTORY_ORDER_STATUS_CHANGED_EVENT, { status: "Shipped" }, OCCURRED)
    ).toBeNull();
  });

  it("returns null for a status-changed event with no status", () => {
    expect(
      buildInventoryOrderActivity(
        INVENTORY_ORDER_STATUS_CHANGED_EVENT,
        { id: "inv_order_1", previous_status: "Pending" },
        OCCURRED
      )
    ).toBeNull();
  });

  it("exposes exactly the three subscribed events", () => {
    expect(INVENTORY_ORDER_ACTIVITY_EVENTS).toEqual([
      INVENTORY_ORDER_STATUS_CHANGED_EVENT,
      "inventory_order_assigned_to_partner",
      "inventory_order_partner_link_rolled_back",
    ]);
  });
});
