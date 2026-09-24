import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import WorkOrderModule from "../modules/work_orders"

// #2262 S0 — READ-ONLY: `work_order.partner_id` → the partner doing the work.
// No pivot table: the id lives on the row (filterable, indexed) and query.graph
// follows it (`work_order.partner.*`). Replaces the D3 partner↔order pivot the
// #342 mirror needed.
export default defineLink(
  { linkable: WorkOrderModule.linkable.workOrder, field: "partner_id" },
  PartnerModule.linkable.partner,
  { readOnly: true }
)
