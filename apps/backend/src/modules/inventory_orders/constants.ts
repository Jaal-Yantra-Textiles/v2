export const INVENTORY_ORDER_STATUS = [
  "Pending",
  "Processing",
  // #790 — packed/ready to hand to the carrier, before the shipment/AWB exists.
  "Ready for Delivery",
  "Shipped",
  "Delivered",
  "Cancelled",
] as const;
export type InventoryOrderStatus = typeof INVENTORY_ORDER_STATUS[number];
