import { defineLink } from "@medusajs/framework/utils"
import ProductionRunsModule from "../modules/production_runs"
import WorkOrderModule from "../modules/work_orders"

// #2262 S0 — READ-ONLY: a work-order line → the run it is. The run owns its
// cost (`cost_type`, `partner_cost_estimate`); read them through here instead
// of copying them onto the line.
export default defineLink(
  { linkable: WorkOrderModule.linkable.workOrderItem, field: "production_run_id" },
  // Named `production_run` (singular — a line is ONE run): the plural
  // `production_runs` alias is already the work_order ↔ runs link, and a
  // module may not register the same alias twice.
  { linkable: ProductionRunsModule.linkable.productionRuns, alias: "production_run" },
  { readOnly: true }
)
