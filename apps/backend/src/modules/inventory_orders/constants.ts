// Canonical set of inventory-order statuses. This is the SINGLE source of truth
// — the DB enum (models/order.ts), validators, services and admin filters all
// derive from here so they can never drift again (#778 H8).
//
// "Partial" is system-set only: the complete-inventory-order workflow writes it
// when a partner records a short/partial fulfillment. It is a real, queryable
// status (you can filter by it), but it is NOT user-settable via create/update
// — see INVENTORY_ORDER_STATUS_INPUT below.
export const INVENTORY_ORDER_STATUS = [
  "Pending",
  "Processing",
  // #790 — packed/ready to hand to the carrier, before the shipment/AWB exists.
  "Ready for Delivery",
  "Shipped",
  // #778 H8 — set by the system on a partial/short fulfillment.
  "Partial",
  "Delivered",
  "Cancelled",
] as const;
export type InventoryOrderStatus = typeof INVENTORY_ORDER_STATUS[number];

// System-only statuses an API client may never set directly. Keep this list
// here (next to the canonical set) so the exclusion is intentional and visible.
export const INVENTORY_ORDER_SYSTEM_STATUS = ["Partial"] as const;
export type InventoryOrderSystemStatus =
  (typeof INVENTORY_ORDER_SYSTEM_STATUS)[number];

// Statuses a create/update request is allowed to set. Derived from the
// canonical set minus the system-only ones, so adding a new status in one place
// keeps create/update validation correct without a second edit.
export const INVENTORY_ORDER_STATUS_INPUT = INVENTORY_ORDER_STATUS.filter(
  (s): s is Exclude<InventoryOrderStatus, InventoryOrderSystemStatus> =>
    !(INVENTORY_ORDER_SYSTEM_STATUS as readonly string[]).includes(s)
);
export type InventoryOrderInputStatus =
  (typeof INVENTORY_ORDER_STATUS_INPUT)[number];
