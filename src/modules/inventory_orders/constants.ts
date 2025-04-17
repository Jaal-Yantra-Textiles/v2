export const INVENTORY_ORDER_STATUS = [
  "Pending",
  "Processing",
  "Shipped",
  "Delivered",
  "Cancelled",
] as const;
export type InventoryOrderStatus = typeof INVENTORY_ORDER_STATUS[number];
