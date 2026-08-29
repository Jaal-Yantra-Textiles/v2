import { model } from "@medusajs/framework/utils";
import OrderLine from "./orderline";

const InventoryOrder = model.define("inventory_orders", {
  id: model.id({prefix: 'inv_order'}).primaryKey(),
  quantity: model.float(),
  total_price: model.bigNumber(),
  // #778 H9 — the order's currency. Previously absent: the dual-write to the
  // unified order assumed INR (currency_assumed:true). Defaults to "inr" for
  // back-compat; the dual-write now uses this instead of guessing.
  currency_code: model.text().default("inr"),
  status: model.enum([
    "Pending",
    "Processing",
    // #790 — goods packed/ready to hand to the carrier, before the shipment/AWB
    // is created. Sits between Processing and Shipped in the lifecycle.
    "Ready for Delivery",
    "Shipped",
    "Delivered",
    "Cancelled",
    "Partial"
  ]).default("Pending"),
  expected_delivery_date: model.dateTime().nullable(),
  order_date: model.dateTime().nullable(),
  orderlines: model.hasMany(() => OrderLine),
  metadata: model.json().nullable(),
  shipping_address: model.json().nullable(),
  is_sample: model.boolean().default(false),
  // Cancellation audit (#778 C4). Typed columns rather than metadata, because
  // these are load-bearing state that must survive later metadata replacements.
  cancelled_at: model.dateTime().nullable(),
  cancellation_reason: model.text().nullable(),
  cancelled_by: model.text().nullable(),
}).cascades({
  delete: ['orderlines']
});

export default InventoryOrder;
