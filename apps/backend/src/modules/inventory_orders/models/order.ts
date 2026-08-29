import { model } from "@medusajs/framework/utils";
import OrderLine from "./orderline";

const InventoryOrder = model.define("inventory_orders", {
  id: model.id({prefix: 'inv_order'}).primaryKey(),
  quantity: model.float(),
  total_price: model.bigNumber(),
  /**
   * What was AGREED with the partner for this order — which is not what the
   * order was priced at (#1617).
   *
   * `total_price` is Σ(line quantity × line price): on
   * `inv_order_01K76V5J4KKS3EC71D2R2MNJSP` that is ₹63,375.75, while the price
   * actually agreed with the partner was ₹35,000. A payout guard comparing
   * against the ordered total would have allowed ₹28,375 more than anyone
   * agreed to pay, so the agreed figure needs a typed home rather than living
   * in a submission's `metadata.agreed_total`.
   *
   * Nullable on purpose: historical orders have no agreed figure recorded, and
   * inventing one is worse than admitting it is absent. The payout guard falls
   * back to `total_price` when this is null.
   */
  agreed_total: model.bigNumber().nullable(),
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
