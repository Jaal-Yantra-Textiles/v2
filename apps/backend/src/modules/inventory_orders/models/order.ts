import { model } from "@medusajs/framework/utils";
import OrderLine from "./orderline";
import OrderCharge from "./order-charge";

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
  /**
   * Amounts that are not goods — tax, shipping, a discount or a write-off
   * (#1737). ⚠️ `total_price` above stays GOODS; the payable ceiling is derived
   * from both in `lib/order-charges.ts`, never by folding them together.
   */
  charges: model.hasMany(() => OrderCharge),
  metadata: model.json().nullable(),
  shipping_address: model.json().nullable(),
  is_sample: model.boolean().default(false),
  // Cancellation audit (#778 C4). Typed columns rather than metadata, because
  // these are load-bearing state that must survive later metadata replacements.
  cancelled_at: model.dateTime().nullable(),
  cancellation_reason: model.text().nullable(),
  cancelled_by: model.text().nullable(),
  /**
   * #780 H7c — the workflow transaction id that currently owns this order's
   * partner assignment, or null when unassigned.
   *
   * This is the claim a `send-to-partner` run takes atomically before it
   * creates any task or messages the partner. A typed column rather than
   * metadata for the same reason as the cancellation audit above: it is
   * load-bearing state that must survive a later metadata replacement.
   *
   * The cross-partner case was never the hole — `Link.create` already refuses
   * a second partner for one order (the singular-side uniqueness behind
   * #1775). What this closes is two concurrent sends to the SAME partner,
   * where the duplicate link is a silent no-op and both runs went on to
   * duplicate the tasks, the partner notification, and the workflow.
   */
  partner_assignment_id: model.text().nullable(),
}).cascades({
  delete: ['orderlines']
});

export default InventoryOrder;
