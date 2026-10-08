import { model } from "@medusajs/framework/utils"

/**
 * #2289 S3 — the receiver counted LESS than the supplier dispatched on a line
 * (founder decision 2026-10-08).
 *
 * Written by the receive workflow (admin receive, or the receiving partner's
 * Incoming deliveries confirm) when a counted line falls short of what was
 * dispatched and is still uncounted. It does not move stock or money; it is
 * the record that the gap exists, so it leaves the "awaiting count" list,
 * our admin team gets a task, and the supplier sees the short count.
 *
 * `open` until resolved. A later receipt that covers the gap (the missing box
 * turned up) resolves it automatically; an admin can also resolve it with a
 * note (credited, written off, re-sent).
 *
 * Plain id columns, like `inventory_dispatch`.
 */
const InventoryShortfall = model.define("inventory_shortfall", {
  id: model.id({ prefix: "inv_short" }).primaryKey(),
  inventory_order_id: model.text().index("IDX_inventory_shortfall_order_id"),
  inventory_order_line_id: model.text().index("IDX_inventory_shortfall_line_id"),
  /** How much is missing, as recorded. float: metres / kg. */
  quantity: model.float(),
  /** Line totals at the moment of recording, for the record. */
  dispatched_quantity: model.float(),
  received_quantity: model.float(),
  status: model.enum(["open", "resolved"]).default("open"),
  /** Partner id when the receiving partner counted; null for our team. */
  counted_by_partner_id: model.text().nullable(),
  counted_by: model.text().nullable(),
  resolved_at: model.dateTime().nullable(),
  resolution_note: model.text().nullable(),
  task_id: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default InventoryShortfall
