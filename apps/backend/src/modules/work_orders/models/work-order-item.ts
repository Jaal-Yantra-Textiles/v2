import { model } from "@medusajs/framework/utils"
import WorkOrder from "./work-order"

/**
 * #2262 S0 — one line of a work order. Every fact is a typed column; there is
 * no `metadata` blob on a line, and nothing another module owns is copied.
 *
 * The #342 mirror kept these in `items[].metadata` (measured 2026-09-24):
 *   design lines    — design_id, production_run_id, cost_type, legacy_cost_estimate
 *   inventory lines — inventory_item_id, legacy_orderline_id, legacy_unit_price
 * Kept: `design_id`, `production_run_id` (partner-ui reads them) and
 * `inventory_order_line_id` (the line-sync key). Dropped: `cost_type` /
 * `cost_estimate` belong to the RUN (read them through the link — a copy here
 * drifts); `inventory_item_id` is reachable through the inventory order line;
 * `legacy_unit_price` always equalled `unit_price`.
 *
 * `unit_price` IS stored: it is the price this order agreed, a fact of the
 * order, not of the run.
 *
 * `quantity` is a bigNumber because inventory lines are fractional (70.6 m of
 * cloth), not whole garments.
 */
const WorkOrderItem = model
  .define("work_order_item", {
    id: model.id({ prefix: "ordli" }).primaryKey(),
    title: model.text(),
    subtitle: model.text().nullable(),
    thumbnail: model.text().nullable(),
    quantity: model.bigNumber(),
    unit_price: model.bigNumber(),

    /** Which design this line is. Read-only link → design. Read by partner-ui. */
    design_id: model.text().nullable(),
    /** Which run this line is. Read-only link → production run. Read by partner-ui. */
    production_run_id: model.text().nullable(),
    /**
     * For inventory lines: the inventory order's own line this mirrors. How a
     * line is matched when the inventory order is edited (S3 line sync).
     */
    inventory_order_line_id: model.text().nullable(),

    work_order: model.belongsTo(() => WorkOrder, { mappedBy: "items" }),
  })
  .indexes([
    { on: ["production_run_id"] },
    { on: ["design_id"] },
    { on: ["inventory_order_line_id"] },
  ])

export default WorkOrderItem
