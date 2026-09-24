import { model } from "@medusajs/framework/utils"
import WorkOrder from "./work-order"

/**
 * #2262 S0 — one line of a work order. EVERY fact is a typed column; there is
 * deliberately no `metadata` blob on a line.
 *
 * The #342 mirror kept these in `items[].metadata` (measured 2026-09-24):
 *   design lines    — design_id, production_run_id, cost_type, legacy_cost_estimate
 *   inventory lines — inventory_item_id, legacy_orderline_id, legacy_unit_price
 * `legacy_unit_price` was always equal to `unit_price`, so it is not carried.
 *
 * partner-ui reads `items[].metadata.design_id` / `.production_run_id`
 * (collated-design-runs, design-order-lines); `toOrderShape()` echoes those two
 * columns into the response's `metadata` so the API shape does not change.
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

    // --- design lines (kind=design) ---
    design_id: model.text().nullable(),
    production_run_id: model.text().nullable(),
    /** How the run's `partner_cost_estimate` was expressed; decides `unit_price`. */
    cost_type: model.enum(["per_unit", "total"]).nullable(),
    /** The run's `partner_cost_estimate` as captured (null = not estimated yet). */
    cost_estimate: model.bigNumber().nullable(),

    // --- inventory lines (kind=inventory) ---
    inventory_item_id: model.text().nullable(),
    /** The inventory order's own line this mirrors (was `legacy_orderline_id`). */
    inventory_order_line_id: model.text().nullable(),

    work_order: model.belongsTo(() => WorkOrder, { mappedBy: "items" }),
  })
  .indexes([
    { on: ["production_run_id"] },
    { on: ["design_id"] },
    { on: ["inventory_order_line_id"] },
  ])

export default WorkOrderItem
