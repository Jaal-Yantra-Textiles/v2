import { model } from "@medusajs/framework/utils"

/**
 * A supplier's DISPATCH of an inventory order line — what they say they sent
 * (#2289, founder decision 2026-10-08).
 *
 * 🔴 Deliberately NOT a `line_fulfillment` row. Twenty readers (cancel's stock
 * reversal, payout valuation, the close job, the drift audits) sum every
 * `line_fulfillment.quantity_delta` as goods RECEIVED. A dispatch written there
 * would be reversed out of stock that was never posted, and paid for before
 * anyone counted it. `line_fulfillment` stays the receipt ledger; this table is
 * the supplier's claim.
 *
 * A dispatch posts no stock. Only a receiver's count does (admin receive, or
 * the receiving partner's Incoming deliveries confirm). Dispatched minus
 * received is either in transit or, once counted, the shortfall.
 *
 * Plain id columns, not module links: one table, read by order id, and nothing
 * else needs to traverse to it.
 */
const InventoryDispatch = model.define("inventory_dispatch", {
  id: model.id({ prefix: "inv_disp" }).primaryKey(),
  inventory_order_id: model.text().index("IDX_inventory_dispatch_order_id"),
  inventory_order_line_id: model.text().index("IDX_inventory_dispatch_line_id"),
  /** float: raw-material units (m, kg) take decimals (#342). */
  quantity: model.float(),
  partner_id: model.text().nullable(),
  dispatched_at: model.dateTime(),
  delivery_date: model.text().nullable(),
  tracking_number: model.text().nullable(),
  notes: model.text().nullable(),
  /** The completing workflow's transaction, for rollback and tracing. */
  transaction_id: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default InventoryDispatch
